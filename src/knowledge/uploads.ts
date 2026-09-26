import type { Db } from "../db.js";
import { newId } from "../lib/ids.js";
import { download, remove, signedDownloadUrl, signedUploadUrl, storageConfigured } from "../lib/storage.js";
import { capText, sha256 } from "./discover.js";
import { cachedExtractions, chunk, extractNow, type ExtractUnit } from "./extract.js";
import { saveCards, type ExtractedCard } from "./cards.js";
import { refreshProductSummaries } from "./products.js";

/**
 * Brochures, price lists, decks, screenshots. The cheapest way to read each:
 * - PDFs with a text layer: the browser extracts the text (pdf.js) and sends only text
 * - images: the browser downscales to 1280 px (about 1,200 tokens) before sending
 * - scanned PDFs: read from storage and sent to Claude as a document
 * The same file (by SHA-256) is never processed twice.
 */

export const UPLOAD_TYPES: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "text/plain": "txt", "text/markdown": "md",
};
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PARTS = 12; // about 30k tokens of text per file
const MAX_SCANNED_PDF_BYTES = 20 * 1024 * 1024;

export class UploadError extends Error {}

export interface UploadRow {
  id: string; workspace_id: string; sha256: string; filename: string; mime: string; size_bytes: number; storage_path: string | null;
  status: "pending" | "uploaded" | "processed" | "failed"; pages: number | null; cards_added: number; error: string | null; created_at: string;
}

export async function createUpload(db: Db, ws: string, input: { filename: string; mime: string; size: number; sha256: string }): Promise<{ upload: UploadRow; upload_url: string | null; existing: boolean; storage: boolean }> {
  const ext = UPLOAD_TYPES[input.mime];
  if (!ext) throw new UploadError("Upload a PDF, an image (PNG, JPG, WebP) or a text file. For Word or PowerPoint files, save as PDF first.");
  if (input.size > MAX_UPLOAD_BYTES) throw new UploadError("Files can be up to 50 MB.");
  if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new UploadError("Invalid file fingerprint.");
  const existing = (await db.query<UploadRow>("select * from uploads where workspace_id = $1 and sha256 = $2", [ws, input.sha256])).rows[0];
  if (existing && existing.status === "processed") return { upload: existing, upload_url: null, existing: true, storage: storageConfigured() };
  const path = storageConfigured() ? `ws/${ws}/${input.sha256}.${ext}` : null;
  const upload = existing ?? (await db.query<UploadRow>(
    `insert into uploads (id, workspace_id, sha256, filename, mime, size_bytes, storage_path) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [newId("upl"), ws, input.sha256, input.filename.slice(0, 200), input.mime, input.size, path],
  )).rows[0]!;
  const url = path ? await signedUploadUrl(path) : null;
  return { upload, upload_url: url, existing: false, storage: storageConfigured() };
}

export interface ProcessInput {
  text?: string;                                      // extracted in the browser (PDF text layer, .txt, .md)
  image?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string };  // downscaled, base64
  pages?: number;
  scanned?: boolean;                                  // PDF without a text layer: read the original from storage
}

export async function processUpload(db: Db, ws: string, id: string, input: ProcessInput): Promise<UploadRow> {
  const up = (await db.query<UploadRow>("select * from uploads where id = $1 and workspace_id = $2", [id, ws])).rows[0];
  if (!up) throw new UploadError("Upload not found.");
  if (up.status === "processed") return up;
  const units: ExtractUnit[] = [];
  if (input.text && input.text.trim().length > 40) {
    const parts = splitText(input.text).slice(0, MAX_TEXT_PARTS);
    parts.forEach((t, i) => units.push({ id: `${up.id}#${i}`, hash: sha256(t), title: `${up.filename}${parts.length > 1 ? ` (part ${i + 1})` : ""}`, url: null, text: t }));
  } else if (input.image) {
    units.push({ id: up.id, hash: sha256(input.image.data), title: up.filename, url: null, text: null, image: input.image });
  } else if (input.scanned && up.storage_path && up.mime === "application/pdf") {
    if (up.size_bytes > MAX_SCANNED_PDF_BYTES) throw new UploadError("Scanned PDFs can be up to 20 MB. Split it or export the key pages.");
    const buf = await download(up.storage_path);
    units.push({ id: up.id, hash: up.sha256, title: up.filename, url: null, text: null, document: { data: buf.toString("base64") } });
  } else {
    throw new UploadError(up.mime === "application/pdf"
      ? "This PDF has no text layer and file storage isn't set up, so it can't be read. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or upload screenshots of the pages."
      : "Nothing readable was sent for this file.");
  }

  try {
    const cached = await cachedExtractions(db, units.map((u) => u.hash));
    const results: ExtractedCard[][] = units.map((u) => cached.get(u.hash) ?? []);
    const todo = units.map((u, i) => ({ u, i })).filter(({ u }) => !cached.has(u.hash));
    // Text parts go four to a call; images and documents one each.
    const groups = [...chunk(todo.filter((t) => t.u.text != null), 4), ...todo.filter((t) => t.u.text == null).map((t) => [t])];
    for (const g of chunk(groups, 3)) {
      const outs = await Promise.all(g.map((grp) => extractNow(db, ws, grp.map((t) => t.u), "knowledge:upload", 50_000)));
      outs.forEach((per, gi) => g[gi]!.forEach((t, k) => { results[t.i] = per[k]!; }));
    }
    const cards = results.flat();
    const saved = await saveCards(db, ws, cards, (c) => ({ kind: "upload", ref: up.id, url: null, quote: c.quote.slice(0, 240) }), { origin: "upload" });
    const r = await db.query<UploadRow>(
      "update uploads set status = 'processed', cards_added = $3, pages = coalesce($4, pages), error = null where id = $1 and workspace_id = $2 returning *",
      [id, ws, saved.added, input.pages ?? null],
    );
    await refreshProductSummaries(db, ws, { max: 4 }).catch(() => 0);
    return r.rows[0]!;
  } catch (err) {
    await db.query("update uploads set status = 'failed', error = $2 where id = $1", [id, (err as Error).message.slice(0, 300)]);
    throw err;
  }
}

/** Split long text at paragraph breaks into parts of about 2,500 tokens. */
export function splitText(text: string, maxTokens = 2_500): string[] {
  const parts: string[] = [];
  let rest = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  while (rest.length) {
    const part = capText(rest, maxTokens);
    parts.push(part.trim());
    rest = rest.slice(part.length).trim();
  }
  return parts.filter(Boolean);
}

export async function listUploads(db: Db, ws: string): Promise<UploadRow[]> {
  return (await db.query<UploadRow>("select * from uploads where workspace_id = $1 order by created_at desc", [ws])).rows;
}

export async function uploadLink(db: Db, ws: string, id: string): Promise<string | null> {
  const up = (await db.query<UploadRow>("select * from uploads where id = $1 and workspace_id = $2", [id, ws])).rows[0];
  return up?.storage_path && storageConfigured() ? signedDownloadUrl(up.storage_path) : null;
}

/** Deletes the file; cards learned from it stay (they're facts about the business now). */
export async function deleteUpload(db: Db, ws: string, id: string): Promise<void> {
  const up = (await db.query<UploadRow>("delete from uploads where id = $1 and workspace_id = $2 returning *", [id, ws])).rows[0];
  if (up?.storage_path && storageConfigured()) await remove(up.storage_path);
}
