"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/session/SessionProvider";
import type { ClientSearchResult } from "@/lib/api";
import { Input } from "@/components/ui";

// Typeahead over the company client master (public.insightly_contacts). Selecting a row fills the
// Insightly ID and display name; if the lookup is unavailable the form still accepts manual entry.
export function ClientLookup({
  value,
  onChange,
  onSelect,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: ClientSearchResult) => void;
  placeholder?: string;
}) {
  const { api } = useSession();
  const [results, setResults] = useState<ClientSearchResult[]>([]);
  const [available, setAvailable] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuery = useRef("");

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 2 || q === lastQuery.current) return;
    timer.current = setTimeout(() => {
      lastQuery.current = q;
      setBusy(true);
      api
        .searchClients(q)
        .then((r) => {
          setResults(r.results);
          setAvailable(r.available);
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, api]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
      />
      {busy && <span className="pointer-events-none absolute right-2 top-2.5 text-[10px] text-slate-400">Searching…</span>}
      {open && (results.length > 0 || !available) && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200" role="listbox">
          {!available && <li className="px-3 py-2 text-xs text-slate-500">Client master not reachable. Enter the Insightly ID and name manually.</li>}
          {results.map((c) => (
            <li key={c.insightlyId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(c);
                  setOpen(false);
                }}
              >
                <span>
                  <span className="font-medium">{c.displayName}</span>
                  {c.adviser && <span className="ml-2 text-xs text-slate-500">Adviser: {c.adviser}</span>}
                </span>
                <span className="font-mono text-xs text-slate-400">{c.insightlyId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
