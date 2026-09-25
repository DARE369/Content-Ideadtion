import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed webhook to the studio. Signature = HMAC-SHA256(secret, `${timestamp}.${body}`),
 * sent as `X-Signature: sha256=<hex>` with `X-Timestamp`. The studio rejects
 * timestamps older than 5 minutes and de-duplicates on `X-Idempotency-Key` (brief_id).
 */
export function sign(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function verify(secret: string, timestamp: string, body: string, signature: string, now = Date.now(), toleranceMs = 300_000): boolean {
  if (Math.abs(now - Number(timestamp) * 1000) > toleranceMs) return false;
  const expected = Buffer.from(sign(secret, timestamp, body));
  const got = Buffer.from(signature);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export async function postSigned(url: string, secret: string, idempotencyKey: string, payload: unknown, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  return fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": sign(secret, ts, body),
      "x-idempotency-key": idempotencyKey,
    },
    body,
  });
}
