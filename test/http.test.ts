import { afterEach, describe, expect, it } from "vitest";
import { RateLimitedError, TokenBucket, fetchJson, redact, resetBuckets } from "../src/lib/http.js";

afterEach(() => resetBuckets());

describe("token bucket", () => {
  it("refills over time and reports the wait", () => {
    let now = 0;
    const b = new TokenBucket(2, 1 / 1000, () => now);
    expect(b.tryTake()).toBe(0);
    expect(b.tryTake()).toBe(0);
    expect(b.tryTake()).toBe(1000);
    now = 1000;
    expect(b.tryTake()).toBe(0);
  });
});

describe("fetchJson", () => {
  it("retries 5xx then succeeds", async () => {
    let calls = 0;
    const f = (async () => (++calls < 2 ? new Response("oops", { status: 503, headers: { "retry-after": "0" } }) : Response.json({ ok: 1 }))) as unknown as typeof fetch;
    const res = await fetchJson<{ ok: number }>("https://api.example/x", { fetchImpl: f, maxRetries: 2 });
    expect(res.ok).toBe(1);
    expect(calls).toBe(2);
  }, 10_000);

  it("turns persistent 429s into RateLimitedError so work is deferred, not dropped", async () => {
    const f = (async () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } })) as unknown as typeof fetch;
    await expect(fetchJson("https://api.example/y", { fetchImpl: f, maxRetries: 0 })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("throws RateLimitedError when the local bucket is empty for longer than maxWaitMs", async () => {
    const f = (async () => Response.json({})) as unknown as typeof fetch;
    for (let i = 0; i < 200; i++) await fetchJson("https://graph.example/z", { fetchImpl: f, limitKey: "instagram:acc_1" });
    await expect(fetchJson("https://graph.example/z", { fetchImpl: f, limitKey: "instagram:acc_1" })).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("redacts tokens", () => {
    expect(redact("https://x/y?access_token=abc&key=def&a=1")).toBe("https://x/y?access_token=***&key=***&a=1");
  });
});
