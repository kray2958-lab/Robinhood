import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { loadConfig } from "../config.js";

const SECRET_PATTERNS = [
  /Bearer\s+[\w.-]+/gi,
  /access_token["\s:=]+[\w.-]+/gi,
  /refresh_token["\s:=]+[\w.-]+/gi,
  /ROBINHOOD_[A-Z_]+=[^\s]+/gi,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  symbol?: string;
  side?: string;
  quantity?: number;
  amount?: number;
  dryRun: boolean;
  paperTrading: boolean;
  result: "success" | "failure" | "dry_run";
  details?: string;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  const config = loadConfig();
  const logPath = config.ROBINHOOD_AUDIT_LOG_PATH;

  const line = redactSecrets(
    JSON.stringify({
      ...entry,
      details: entry.details ? redactSecrets(entry.details) : undefined,
    }),
  );

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, line + "\n", "utf8");
  } catch {
    // Audit logging must not block trading operations
    console.error("[audit] Failed to write audit log");
  }
}

export function logTradeRequest(
  action: string,
  params: Record<string, unknown>,
  dryRun: boolean,
  paperTrading: boolean,
): void {
  void logAudit({
    timestamp: new Date().toISOString(),
    action,
    symbol: params.symbol as string | undefined,
    side: params.side as string | undefined,
    quantity: params.quantity as number | undefined,
    amount: params.amount as number | undefined,
    dryRun,
    paperTrading,
    result: dryRun ? "dry_run" : "success",
    details: JSON.stringify(params),
  });
}
