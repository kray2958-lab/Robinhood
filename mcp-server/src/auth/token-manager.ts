import {
  getClientId,
  loadConfig,
  ROBINHOOD_OAUTH_URL,
} from "../config.js";
import { AuthenticationError } from "../utils/errors.js";
import type { TokenPair } from "../types/index.js";

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export class TokenManager {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private refreshPromise: Promise<void> | null = null;

  constructor() {
    const config = loadConfig();
    this.accessToken = config.ROBINHOOD_ACCESS_TOKEN ?? null;
    this.refreshToken = config.ROBINHOOD_REFRESH_TOKEN ?? null;

    if (this.accessToken) {
      // Assume token expires in 24h if unknown; refresh proactively
      this.expiresAt = Date.now() + 23 * 60 * 60 * 1000;
    }
  }

  hasCredentials(): boolean {
    return Boolean(this.accessToken || this.refreshToken);
  }

  async getAccessToken(): Promise<string> {
    if (!this.accessToken && !this.refreshToken) {
      throw new AuthenticationError(
        "No Robinhood credentials configured.",
        "Set ROBINHOOD_ACCESS_TOKEN and ROBINHOOD_REFRESH_TOKEN environment variables.",
      );
    }

    if (
      this.accessToken &&
      Date.now() < this.expiresAt - TOKEN_EXPIRY_BUFFER_MS
    ) {
      return this.accessToken;
    }

    await this.refreshAccessToken();
    if (!this.accessToken) {
      throw new AuthenticationError("Failed to obtain access token.");
    }
    return this.accessToken;
  }

  async refreshAccessToken(): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private async doRefresh(): Promise<void> {
    if (!this.refreshToken) {
      if (this.accessToken) {
        return;
      }
      throw new AuthenticationError(
        "Refresh token is missing.",
        "Re-authenticate and update ROBINHOOD_REFRESH_TOKEN.",
      );
    }

    const config = loadConfig();
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      client_id: getClientId(),
      scope: "internal",
    });

    if (config.ROBINHOOD_CLIENT_SECRET) {
      body.set("client_secret", config.ROBINHOOD_CLIENT_SECRET);
    }

    const response = await fetch(ROBINHOOD_OAUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new AuthenticationError(
        "Token refresh failed. Credentials may be expired.",
        "Obtain new tokens via Robinhood OAuth and update environment variables.",
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    };

    this.applyTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in ?? 86400) * 1000,
    });
  }

  applyTokens(tokens: TokenPair): void {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    this.expiresAt = tokens.expiresAt;
  }

  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }
}

let sharedTokenManager: TokenManager | null = null;

export function getTokenManager(): TokenManager {
  if (!sharedTokenManager) {
    sharedTokenManager = new TokenManager();
  }
  return sharedTokenManager;
}
