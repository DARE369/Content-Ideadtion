import { fetchJson } from "../lib/http.js";
import type { AccountRef, TokenResolver } from "./types.js";

/**
 * Asks the studio for a fresh access token for one of its connections.
 * Expected studio endpoint: GET {STUDIO_TOKEN_URL}/{studio_connection_id}
 *   -> { access_token: string, expires_at: string }
 * Tokens are cached in memory only, until one minute before expiry.
 */
export class StudioTokenResolver implements TokenResolver {
  private cache = new Map<string, { token: string; exp: number }>();
  constructor(private readonly baseUrl: string, private readonly apiToken: string) {}

  async accessToken(account: AccountRef): Promise<string> {
    const hit = this.cache.get(account.studio_connection_id);
    if (hit && hit.exp > Date.now() + 60_000) return hit.token;
    const res = await fetchJson<{ access_token: string; expires_at?: string }>(
      `${this.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(account.studio_connection_id)}`,
      { headers: { authorization: `Bearer ${this.apiToken}` }, limitKey: "studio" },
    );
    const exp = res.expires_at ? Date.parse(res.expires_at) : Date.now() + 10 * 60_000;
    this.cache.set(account.studio_connection_id, { token: res.access_token, exp });
    return res.access_token;
  }
}

/** For tests and local scripts. */
export class StaticTokenResolver implements TokenResolver {
  constructor(private readonly tokens: Record<string, string>) {}
  async accessToken(account: AccountRef): Promise<string> {
    const t = this.tokens[account.studio_connection_id];
    if (!t) throw new Error(`no token for ${account.studio_connection_id}`);
    return t;
  }
}
