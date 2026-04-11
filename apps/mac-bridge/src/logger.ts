export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }

  console.log(line);
}
