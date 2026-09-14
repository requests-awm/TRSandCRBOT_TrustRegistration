import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";
import type { DocumentType } from "@/server/domain/types";
import { badRequest } from "@/server/http/errors";

// Evidence files live in one private Supabase Storage bucket. Only the service role can read or
// write it (see supabase/sql/003_storage.sql); the browser never touches Storage directly.
export const EVIDENCE_BUCKET = process.env.EVIDENCE_BUCKET ?? "trust-registration-evidence";

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024);

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const DOWNLOAD_URL_TTL_SECONDS = 300;

export interface StoredFile {
  storageKey: string;
  fileHash: string;
  fileSize: number;
  mimeType: string;
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "file";
}

export function buildStorageKey(trustCaseId: string, requirementId: string, documentType: DocumentType, fileName: string): string {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15);
  return `${trustCaseId}/${requirementId}/${documentType}/${stamp}-${safeFileName(fileName)}`;
}

export function validateUpload(file: { size: number; type: string; name: string }): void {
  if (file.size <= 0) throw badRequest("The uploaded file is empty");
  if (file.size > MAX_UPLOAD_BYTES) throw badRequest(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`);
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME_TYPES.has(mime)) throw badRequest(`File type ${mime} is not accepted. Upload a PDF, PNG, JPEG or Word document.`);
}

export async function storeEvidenceFile(input: {
  trustCaseId: string;
  requirementId: string;
  documentType: DocumentType;
  file: File;
}): Promise<StoredFile> {
  validateUpload(input.file);

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const storageKey = buildStorageKey(input.trustCaseId, input.requirementId, input.documentType, input.file.name);
  const mimeType = input.file.type || "application/octet-stream";

  const client = createServiceClient();
  const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(storageKey, bytes, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "0",
  });

  if (error) {
    throw new Error(`Failed to store evidence file in bucket ${EVIDENCE_BUCKET}: ${error.message}`);
  }

  return { storageKey, fileHash, fileSize: bytes.length, mimeType };
}

// Short-lived signed URL. The caller has already checked that the user may see this document.
export async function createEvidenceDownloadUrl(storageKey: string, downloadAs: string): Promise<{ url: string; expiresAt: string }> {
  const client = createServiceClient();
  const { data, error } = await client.storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(storageKey, DOWNLOAD_URL_TTL_SECONDS, { download: safeFileName(downloadAs) });

  if (error || !data) {
    throw new Error(`Failed to create download link: ${error?.message ?? "no URL returned"}`);
  }

  return { url: data.signedUrl, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString() };
}
