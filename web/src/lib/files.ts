import { api } from "./api";
import type { UploadRow } from "./types";

/**
 * Uploading a file the cheapest way: the original goes straight to storage
 * (never through our server), and the AI reads only what it needs:
 * PDF text extracted here in the browser, images downscaled here to 1280 px.
 */

export const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.md,application/pdf,image/png,image/jpeg,image/webp,text/plain,text/markdown";

async function sha256(file: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function mimeOf(file: File): string {
  if (file.type) return file.type === "image/jpg" ? "image/jpeg" : file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "md" ? "text/markdown" : ext === "txt" ? "text/plain" : ext === "pdf" ? "application/pdf" : "";
}

/** PDF text layer via pdf.js (loaded on demand). Scanned PDFs come back nearly empty. */
async function pdfText(file: File): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      line += item.str ?? "";
      if (item.hasEOL) { lines.push(line); line = ""; }
    }
    if (line) lines.push(line);
    parts.push(lines.join("\n"));
  }
  return { text: parts.join("\n\n"), pages: doc.numPages };
}

/** Downscale to 1280 px on the long side (about 1,200 tokens) and re-encode as JPEG. */
async function downscale(file: File): Promise<{ media_type: "image/jpeg"; data: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

export type UploadStep = "fingerprint" | "upload" | "read" | "done";

export async function uploadAndRead(ws: string, file: File, onStep: (s: UploadStep) => void): Promise<{ upload: UploadRow; existing: boolean }> {
  const mime = mimeOf(file);
  onStep("fingerprint");
  const hash = await sha256(file);
  const created = await api.createUpload(ws, { filename: file.name, mime, size: file.size, sha256: hash });
  if (created.existing) return { upload: created.upload, existing: true };
  if (created.upload_url) {
    onStep("upload");
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    const res = await fetch(created.upload_url, { method: "PUT", body: form, headers: { "x-upsert": "true" } });
    if (!res.ok) throw new Error(`The file couldn't be stored (${res.status}). Try again.`);
  }
  onStep("read");
  let upload: UploadRow;
  if (mime === "application/pdf") {
    const { text, pages } = await pdfText(file);
    const scanned = text.replace(/\s+/g, " ").trim().length < pages * 100;
    upload = await api.processUpload(ws, created.upload.id, scanned ? { scanned: true, pages } : { text, pages });
  } else if (mime.startsWith("image/")) {
    upload = await api.processUpload(ws, created.upload.id, { image: await downscale(file) });
  } else {
    upload = await api.processUpload(ws, created.upload.id, { text: await file.text() });
  }
  onStep("done");
  return { upload, existing: false };
}
