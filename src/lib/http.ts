import { config } from "../config.js";

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly url: string, public readonly body: string) {
    super(`HTTP ${status} for ${redact(url)}: ${body.slice(0, 300)}`);
  }
}

/** Thrown when a limit is hit; callers defer the work (snapshots are queued, never dropped). */
export class RateLimitedError extends Error {
  constructor(public readonly key: string, public readonly retryAfterMs: number) {
    super(`rate limited on ${key}; retry in ${Math.ceil(retryAfterMs / 1000)}s`);
  }
}

/** Classic token bucket; `cost` lets one bucket model YouTube quota units. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  /** Returns 0 when the tokens were taken, otherwise the ms to wait. */
  tryTake(cost = 1): number {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + (t - this.last) * this.refillPerMs);
    this.last = t;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return 0;
    }
    return Math.ceil((cost - this.tokens) / this.refillPerMs);
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Per-platform limits. Keys may be suffixed per account, e.g. `instagram:acc_123`. */
const LIMIT_DEFAULTS: Record<string, { capacity: number; periodMs: number }> = {
  instagram: { capacity: 200, periodMs: HOUR }, // 200 calls per user per hour
  facebook: { capacity: 200, periodMs: HOUR },
  tiktok: { capacity: 600, periodMs: 60_000 },
  linkedin: { capacity: 100, periodMs: 60_000 },
  youtube_quota: { capacity: 10_000, periodMs: DAY }, // quota units per project per day
  youtube_analytics: { capacity: 200, periodMs: 60_000 },
  wikimedia: { capacity: 100, periodMs: 1_000 },
  stackexchange: { capacity: 30, periodMs: 1_000 },
  websites: { capacity: 20, periodMs: 5_000 }, // polite crawling: about 4 requests a second per site
  default: { capacity: 60, periodMs: 60_000 },
};

const buckets = new Map<string, TokenBucket>();

export function bucketFor(key: string): TokenBucket {
  let b = buckets.get(key);
  if (!b) {
    const base = key.split(":")[0]!;
    const { capacity, periodMs } = LIMIT_DEFAULTS[base] ?? LIMIT_DEFAULTS.default!;
    b = new TokenBucket(capacity, capacity / periodMs);
    buckets.set(key, b);
  }
  return b;
}

export function resetBuckets(): void {
  buckets.clear();
}

export interface RequestOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** Token bucket key; defaults to the host name. */
  limitKey?: string;
  cost?: number;
  maxRetries?: number;
  /** Wait for tokens when the bucket is briefly empty (up to this many ms) instead of throwing. */
  maxWaitMs?: number;
  fetchImpl?: typeof fetch;
  /** Abort a single attempt after this long. */
  timeoutMs?: number;
  /** Give up rather than wait longer than this between retries. */
  maxBackoffMs?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(url: string, opts: RequestOptions): Promise<Response> {
  const key = opts.limitKey ?? new URL(url).host;
  const wait = bucketFor(key).tryTake(opts.cost ?? 1);
  if (wait > 0) {
    if (wait > (opts.maxWaitMs ?? 2_000)) throw new RateLimitedError(key, wait);
    await sleep(wait);
  }
  const f = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, {
      method: opts.method ?? "GET",
      headers: { "user-agent": config().HTTP_USER_AGENT, ...opts.headers },
      body: opts.body,
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) return res;
    const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 0;
    const backoff = Math.max(retryAfter, 2 ** attempt * 1_000 * (0.75 + Math.random() / 2));
    if (attempt >= maxRetries || backoff > (opts.maxBackoffMs ?? Infinity)) {
      if (res.status === 429) throw new RateLimitedError(key, Math.max(retryAfter, 60_000));
      throw new HttpError(res.status, url, await res.text());
    }
    // Exponential backoff with jitter: 1s, 2s, 4s ... (or the server's retry-after).
    await sleep(backoff);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await request(url, { ...opts, headers: { accept: "application/json", ...opts.headers } });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return JSON.parse(text) as T;
}

export async function fetchText(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return text;
}

export interface PageResponse {
  status: number;
  url: string;
  text: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
}

/**
 * A single conditional GET for crawling: sends If-None-Match / If-Modified-Since
 * when we have them, so an unchanged page answers 304 and costs nothing.
 * Never throws for HTTP status; network errors and timeouts do throw.
 */
export async function fetchPage(
  url: string,
  opts: { etag?: string | null; lastModified?: string | null; timeoutMs?: number; userAgent?: string; maxBytes?: number; fetchImpl?: typeof fetch } = {},
): Promise<PageResponse> {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch { /* fetch below rejects it */ }
  const bucket = bucketFor(`websites:${host}`);
  for (let wait = bucket.tryTake(1); wait > 0; wait = bucket.tryTake(1)) await sleep(Math.min(wait, 1_000));
  const res = await (opts.fetchImpl ?? fetch)(url, {
    headers: {
      "user-agent": opts.userAgent ?? config().HTTP_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml,text/xml,text/plain,*/*;q=0.5",
      ...(opts.etag ? { "if-none-match": opts.etag } : {}),
      ...(opts.lastModified ? { "if-modified-since": opts.lastModified } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
  });
  const contentType = res.headers.get("content-type") ?? "";
  let text = "";
  if (res.status !== 304 && /text|html|xml|json/i.test(contentType || "text/html")) {
    text = await res.text();
    if (opts.maxBytes && text.length > opts.maxBytes) text = text.slice(0, opts.maxBytes);
  } else {
    await res.body?.cancel().catch(() => undefined);
  }
  return { status: res.status, url: res.url || url, text, contentType, etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified") };
}

/** Keep tokens and keys out of logs and error messages. */
export function redact(url: string): string {
  return url.replace(/(access_token|key|token)=[^&]+/gi, "$1=***");
}
