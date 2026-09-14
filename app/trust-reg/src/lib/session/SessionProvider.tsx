"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { UserRole } from "@/server/domain/types";
import { getApi, type SessionUser, type TrustRegApi } from "@/lib/api";
import { readDevRole, writeDevRole } from "./devRole";

interface SessionContextValue {
  api: TrustRegApi;
  user: SessionUser | null;
  loading: boolean;
  canSwitchRole: boolean;
  switchRole: (role: UserRole) => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const api = useMemo(() => getApi(), []);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setRoleTick] = useState(0);

  const canSwitchRole = api.mode === "mock" || process.env.NEXT_PUBLIC_AUTH_MODE === "dev";

  const refresh = useCallback(
    () =>
      api
        .me()
        .then(setUser)
        .catch(() => setUser(null))
        .finally(() => setLoading(false)),
    [api]
  );

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((u) => !cancelled && setUser(u))
      .catch(() => !cancelled && setUser(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api]);

  const switchRole = useCallback(
    (role: UserRole) => {
      writeDevRole(role);
      setRoleTick((n) => n + 1);
      void refresh();
    },
    [refresh]
  );

  const value = useMemo<SessionContextValue>(
    () => ({ api, user, loading, canSwitchRole, switchRole, refresh }),
    [api, user, loading, canSwitchRole, switchRole, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}

export function useDevRole(): UserRole {
  const { user } = useSession();
  return user?.role ?? readDevRole();
}
