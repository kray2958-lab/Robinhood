import { z } from "zod";

const envSchema = z.object({
  ROBINHOOD_CLIENT_ID: z.string().optional(),
  ROBINHOOD_CLIENT_SECRET: z.string().optional(),
  ROBINHOOD_ACCESS_TOKEN: z.string().optional(),
  ROBINHOOD_REFRESH_TOKEN: z.string().optional(),
  ROBINHOOD_MCP_SERVER_URL: z
    .string()
    .default("https://agent.robinhood.com/mcp/trading"),
  ROBINHOOD_PAPER_TRADING: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ROBINHOOD_CRYPTO_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ROBINHOOD_MCP_HTTP_PORT: z.coerce.number().default(3100),
  ROBINHOOD_AUDIT_LOG_PATH: z.string().default("./logs/audit.log"),
  ROBINHOOD_RATE_LIMIT_PER_MINUTE: z.coerce.number().default(60),
});

export type Config = z.infer<typeof envSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = envSchema.parse(process.env);
  }
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}

export const ROBINHOOD_API_BASE = "https://api.robinhood.com";
export const ROBINHOOD_OAUTH_URL = `${ROBINHOOD_API_BASE}/oauth2/token/`;
export const ROBINHOOD_MCP_TRADING_URL =
  "https://agent.robinhood.com/mcp/trading";

/** Default public client ID used by Robinhood web app */
export const DEFAULT_CLIENT_ID =
  "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS";

export function getClientId(): string {
  const config = loadConfig();
  return config.ROBINHOOD_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export function isPaperTrading(): boolean {
  return loadConfig().ROBINHOOD_PAPER_TRADING;
}

export function isCryptoEnabled(): boolean {
  return loadConfig().ROBINHOOD_CRYPTO_ENABLED;
}
