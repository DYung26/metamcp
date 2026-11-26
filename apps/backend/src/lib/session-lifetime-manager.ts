import logger from "@/utils/logger";

import { configService } from "./config.service";
import { SessionAgeMetrics, summarizeSessionAges } from "./session-age-metrics";

export interface SessionLifetimeManager<T> {
  addSession(sessionId: string, session: T): void;
  removeSession(sessionId: string): void;
  getSession(sessionId: string): T | undefined;
  touchSession(sessionId: string): void;
  getAllSessions(): Map<string, T>;
  getSessionAge(sessionId: string): number | undefined;
  getSessionAgeMetrics(): SessionAgeMetrics;
  getSessionIdleAgeMetrics(): SessionAgeMetrics;
  isSessionExpired(sessionId: string): Promise<boolean>;
  cleanupExpiredSessions(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
  ): Promise<void>;
  startCleanupTimer(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
    intervalMs?: number,
  ): void;
  stopCleanupTimer(): void;
}

export class SessionLifetimeManagerImpl<
  T,
> implements SessionLifetimeManager<T> {
  private sessions: Map<string, T> = new Map();
  private sessionTimestamps: Map<string, number> = new Map();
  private sessionCreatedAt: Map<string, number> = new Map();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private cleaningSessionIds = new Set<string>();
  private readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  addSession(sessionId: string, session: T): void {
    const now = Date.now();
    this.sessions.set(sessionId, session);
    this.sessionTimestamps.set(sessionId, now);
    this.sessionCreatedAt.set(sessionId, now);
  }

  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.sessionTimestamps.delete(sessionId);
    this.sessionCreatedAt.delete(sessionId);
  }

  getSession(sessionId: string): T | undefined {
    return this.sessions.get(sessionId);
  }

  /** Refresh the idle-expiry clock when a client uses an existing session. */
  touchSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.sessionTimestamps.set(sessionId, Date.now());
    }
  }

  getAllSessions(): Map<string, T> {
    return new Map(this.sessions);
  }

  getSessionAge(sessionId: string): number | undefined {
    const timestamp = this.sessionCreatedAt.get(sessionId);
    return timestamp === undefined ? undefined : Date.now() - timestamp;
  }

  getSessionAgeMetrics(): SessionAgeMetrics {
    return summarizeSessionAges(this.sessionCreatedAt.values());
  }

  getSessionIdleAgeMetrics(): SessionAgeMetrics {
    return summarizeSessionAges(this.sessionTimestamps.values());
  }

  async isSessionExpired(sessionId: string): Promise<boolean> {
    const lastActivity = this.sessionTimestamps.get(sessionId);
    if (lastActivity === undefined) return false;
    const age = Date.now() - lastActivity;

    const sessionLifetime = await configService.getSessionLifetime();
    // If session lifetime is null, sessions are infinite and never expire
    if (sessionLifetime === null) return false;

    return age > sessionLifetime;
  }

  async cleanupExpiredSessions(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
  ): Promise<void> {
    try {
      const sessionLifetime = await configService.getSessionLifetime();

      // If session lifetime is null, sessions are infinite - skip cleanup
      if (sessionLifetime === null) {
        return;
      }

      const now = Date.now();
      const expiredSessions: Array<{ sessionId: string; session: T }> = [];

      // Find expired sessions
      for (const [sessionId, timestamp] of this.sessionTimestamps.entries()) {
        if (now - timestamp > sessionLifetime) {
          const session = this.sessions.get(sessionId);
          if (session && !this.cleaningSessionIds.has(sessionId)) {
            // Claim synchronously before any await so overlapping timer runs
            // cannot invoke cleanup twice for the same session.
            this.cleaningSessionIds.add(sessionId);
            expiredSessions.push({ sessionId, session });
          }
        }
      }

      // Clean up expired sessions
      if (expiredSessions.length > 0) {
        logger.info(
          `Cleaning up ${expiredSessions.length} expired ${this.name} sessions: ${expiredSessions.map((s) => s.sessionId).join(", ")}`,
        );

        const cleanupResults = await Promise.allSettled(
          expiredSessions.map(async ({ sessionId, session }) => {
            try {
              // A request may have refreshed the session after the sweep
              // snapshot was taken. Recheck before closing its transport.
              const timestamp = this.sessionTimestamps.get(sessionId);
              if (
                this.sessions.get(sessionId) !== session ||
                timestamp === undefined ||
                Date.now() - timestamp <= sessionLifetime
              ) {
                return;
              }
              await cleanupCallback(sessionId, session);
            } finally {
              this.cleaningSessionIds.delete(sessionId);
            }
          }),
        );

        cleanupResults.forEach((result, index) => {
          if (result.status === "rejected") {
            const { sessionId } = expiredSessions[index];
            logger.error(
              `Error cleaning up expired ${this.name} session ${sessionId}:`,
              result.reason,
            );
          }
        });
      }
    } catch (error) {
      logger.error(
        `Error during automatic ${this.name} session cleanup:`,
        error,
      );
    }
  }

  startCleanupTimer(
    cleanupCallback: (sessionId: string, session: T) => Promise<void>,
    intervalMs: number = 5 * 60 * 1000, // Default: 5 minutes
  ): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupExpiredSessions(cleanupCallback);
    }, intervalMs);
  }

  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // Utility methods for getting session counts and IDs
  getSessionCount(): number {
    return this.sessions.size;
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  getSessionTimestamps(): Map<string, number> {
    return new Map(this.sessionTimestamps);
  }
}
