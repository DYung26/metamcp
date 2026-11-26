import logger from "@/utils/logger";

export interface MetaMcpLogEntry {
  id: string;
  timestamp: Date;
  serverName: string;
  level: "error" | "info" | "warn";
  message: string;
  error?: string;
}

class MetaMcpLogStore {
  private readonly maxLogs = 1000;
  private logs: MetaMcpLogEntry[] = [];
  private nextLogIndex = 0;
  private logCount = 0;
  private readonly listeners: Set<(log: MetaMcpLogEntry) => void> = new Set();

  addLog(
    serverName: string,
    level: MetaMcpLogEntry["level"],
    message: string,
    error?: unknown,
  ) {
    const logEntry: MetaMcpLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      serverName,
      level,
      message,
      error: error
        ? error instanceof Error
          ? error.message
          : String(error)
        : undefined,
    };

    this.logs[this.nextLogIndex] = logEntry;
    this.nextLogIndex = (this.nextLogIndex + 1) % this.maxLogs;
    this.logCount = Math.min(this.logCount + 1, this.maxLogs);

    // Also log to console for debugging
    const fullMessage = `[MetaMCP][${serverName}] ${message}`;
    switch (level) {
      case "error":
        logger.error(fullMessage, error || "");
        break;
      case "warn":
        logger.warn(fullMessage, error || "");
        break;
      case "info":
        logger.info(fullMessage, error || "");
        break;
    }

    // Notify listeners
    this.listeners.forEach((listener) => {
      try {
        listener(logEntry);
      } catch (err) {
        logger.error("Error notifying log listener:", err);
      }
    });
  }

  getLogs(limit?: number): MetaMcpLogEntry[] {
    const logs: MetaMcpLogEntry[] = [];
    const oldestLogIndex =
      (this.nextLogIndex - this.logCount + this.maxLogs) % this.maxLogs;

    for (let index = 0; index < this.logCount; index++) {
      logs.push(this.logs[(oldestLogIndex + index) % this.maxLogs]);
    }

    return (limit ? logs.slice(-limit) : logs).reverse();
  }

  clearLogs(): void {
    this.logs = [];
    this.nextLogIndex = 0;
    this.logCount = 0;
  }

  addListener(listener: (log: MetaMcpLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getLogCount(): number {
    return this.logCount;
  }
}

// Singleton instance
export const metamcpLogStore = new MetaMcpLogStore();
