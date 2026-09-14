import { describe, expect, it } from "vitest";
import { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, buildStorageKey, validateUpload } from "./storageService";

const CASE = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";

describe("buildStorageKey", () => {
  it("nests by case, requirement and document type", () => {
    const key = buildStorageKey(CASE, REQ, "trs_proof_of_registration", "cert.pdf");
    expect(key.startsWith(`${CASE}/${REQ}/trs_proof_of_registration/`)).toBe(true);
    expect(key.endsWith("-cert.pdf")).toBe(true);
  });

  it("strips directories and unsafe characters from the file name", () => {
    const key = buildStorageKey(CASE, REQ, "supporting_document", "../../etc/pass wd?.pdf");
    expect(key).not.toContain("..");
    expect(key.split("/")).toHaveLength(4);
    expect(key.endsWith("-pass_wd_.pdf")).toBe(true);
  });

  it("never produces an empty file segment", () => {
    const key = buildStorageKey(CASE, REQ, "supporting_document", "///");
    expect(key.endsWith("-file")).toBe(true);
  });
});

describe("validateUpload", () => {
  const file = (over: Partial<{ size: number; type: string; name: string }> = {}) => ({
    size: 1024,
    type: "application/pdf",
    name: "cert.pdf",
    ...over,
  });

  it("accepts every allowed type at a sensible size", () => {
    for (const type of ALLOWED_MIME_TYPES) expect(() => validateUpload(file({ type }))).not.toThrow();
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateUpload(file({ size: 0 }))).toThrow(/empty/);
    expect(() => validateUpload(file({ size: MAX_UPLOAD_BYTES + 1 }))).toThrow(/limit/);
  });

  it("rejects executables and unknown types", () => {
    expect(() => validateUpload(file({ type: "application/x-msdownload" }))).toThrow(/not accepted/);
    expect(() => validateUpload(file({ type: "" }))).toThrow(/not accepted/);
  });

  it("rejections carry a 400 status", () => {
    try {
      validateUpload(file({ size: 0 }));
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});
