"use client";

import { useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import { ApiError } from "@/lib/api";
import { Button } from "../ui";

// Asks the API for a short-lived signed URL, then opens it. The URL is never stored in the page.
export function DownloadButton({
  documentId,
  label = "Download",
  size = "sm",
  variant = "secondary",
}: {
  documentId: string;
  label?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const link = await api.getDocumentDownload(documentId);
      const a = document.createElement("a");
      a.href = link.url;
      a.download = link.fileName;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end">
      <Button size={size} variant={variant} onClick={download} disabled={busy} title={error ?? undefined}>
        {busy ? "Preparing…" : label}
      </Button>
      {error && <span className="mt-0.5 max-w-56 text-right text-[11px] text-red-700">{error}</span>}
    </span>
  );
}
