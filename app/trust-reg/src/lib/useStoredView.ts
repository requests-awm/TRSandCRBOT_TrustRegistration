"use client";

import { useCallback, useSyncExternalStore } from "react";

export type DashboardView = "list" | "board";
const KEY = "trust-reg.dashboard.view";
const listeners = new Set<() => void>();

function read(): DashboardView {
  try {
    return window.localStorage.getItem(KEY) === "board" ? "board" : "list";
  } catch {
    return "list";
  }
}

// Remembers List / Board per browser without a hydration mismatch: the server snapshot is always "list".
export function useStoredView(): [DashboardView, (v: DashboardView) => void] {
  const view = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    },
    read,
    () => "list" as DashboardView
  );
  const setView = useCallback((v: DashboardView) => {
    try {
      window.localStorage.setItem(KEY, v);
    } catch {}
    listeners.forEach((cb) => cb());
  }, []);
  return [view, setView];
}
