import { config } from "../config.js";

/**
 * Supabase Storage over its REST API (no SDK): the browser uploads straight to a
 * signed URL, so files never pass through a Vercel function (4.5 MB body limit).
 * Server-only: the service-role key is never sent to the browser.
 */

export const storageConfigured = (): boolean => Boolean(config().SUPABASE_URL && config().SUPABASE_SERVICE_ROLE_KEY);

const base = () => `${config().SUPABASE_URL!.replace(/\/+$/, "")}/storage/v1`;
const headers = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${config().SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: config().SUPABASE_SERVICE_ROLE_KEY!,
  ...extra,
});
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export class StorageError extends Error {}

async function call(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new StorageError("File storage didn't answer. If your Supabase project is paused, restore it in the Supabase dashboard.");
  }
  if (res.status === 401 || res.status === 403) throw new StorageError("File storage rejected the key. Check SUPABASE_SERVICE_ROLE_KEY on the server.");
  return res;
}

let bucketReady = false;

/** Create the private bucket on first use (50 MB per file, the free-tier maximum). */
export async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const res = await call("/bucket", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ id: config().UPLOAD_BUCKET, name: config().UPLOAD_BUCKET, public: false, file_size_limit: 52_428_800 }),
  });
  const text = await res.text();
  if (!res.ok && !/already exists|Duplicate|409/i.test(text + res.status)) throw new StorageError(`Couldn't prepare file storage (${res.status}).`);
  bucketReady = true;
}

/** A one-time URL the browser PUTs the file to. */
export async function signedUploadUrl(path: string): Promise<string> {
  await ensureBucket();
  const res = await call(`/object/upload/sign/${config().UPLOAD_BUCKET}/${enc(path)}`, { method: "POST", headers: headers({ "x-upsert": "true" }) });
  if (!res.ok) throw new StorageError(`Couldn't prepare the upload (${res.status}).`);
  const j = (await res.json()) as { url: string };
  return `${base()}${j.url}`;
}

export async function download(path: string): Promise<Buffer> {
  const res = await call(`/object/${config().UPLOAD_BUCKET}/${enc(path)}`, { method: "GET", headers: headers() });
  if (!res.ok) throw new StorageError(`Couldn't read the uploaded file (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** A link the studio (or the user) can open for an hour. */
export async function signedDownloadUrl(path: string, expiresIn = 3600): Promise<string> {
  const res = await call(`/object/sign/${config().UPLOAD_BUCKET}/${enc(path)}`, {
    method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) throw new StorageError(`Couldn't create a link (${res.status}).`);
  const j = (await res.json()) as { signedURL: string };
  return `${base()}${j.signedURL}`;
}

export async function remove(path: string): Promise<void> {
  await call(`/object/${config().UPLOAD_BUCKET}`, {
    method: "DELETE", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ prefixes: [path] }),
  }).catch(() => undefined);
}
