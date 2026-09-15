"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session/SessionProvider";
import { ROLE_LABEL } from "@/lib/labels";
import { USER_ROLES, type UserRole } from "@/server/domain/types";
import { resetMockData } from "@/lib/api/mockClient";
import { Select } from "./ui";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/cases/new", label: "New request", roles: ["wm_requester", "administrator"] as UserRole[] },
  { href: "/reports", label: "Reports" },
  { href: "/audit", label: "Audit log" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { api, user, loading, canSwitchRole, switchRole } = useSession();

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 md:flex-row">
      <aside className="flex w-full flex-col border-b border-slate-200 bg-white print:hidden md:min-h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="px-5 py-4">
          <Link href="/dashboard" className="block">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AWM</div>
            <div className="text-base font-semibold">Trust Registration</div>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role))).map((n) => {
            const active = pathname === n.href || (n.href !== "/dashboard" && pathname.startsWith(n.href));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap ${active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto border-t border-slate-200 px-5 py-4 text-xs text-slate-600">
          {loading ? (
            <span>Loading session…</span>
          ) : user ? (
            <>
              <div className="font-medium text-slate-900">{user.fullName ?? user.email}</div>
              <div>{ROLE_LABEL[user.role]}{user.wmTeam ? ` · ${user.wmTeam}` : ""}</div>
            </>
          ) : (
            <Link href="/login" className="font-medium text-slate-900 underline">
              Sign in
            </Link>
          )}
          {canSwitchRole && (
            <div className="mt-3 space-y-2">
              <label className="block text-[11px] font-medium uppercase tracking-wide text-amber-700">Dev role switcher</label>
              <Select value={user?.role ?? "administrator"} onChange={(e) => switchRole(e.target.value as UserRole)} className="text-xs">
                {USER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              {api.mode === "mock" && (
                <button
                  className="text-[11px] text-slate-500 underline"
                  onClick={() => {
                    resetMockData();
                    window.location.reload();
                  }}
                >
                  Reset placeholder data
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
      <div className="flex-1">
        {api.mode === "mock" && (
          <div className="bg-amber-100 px-4 py-1.5 text-center text-xs text-amber-900">
            Placeholder mode: data lives in this browser only. Set NEXT_PUBLIC_DATA_SOURCE=http once the database and API are connected.
          </div>
        )}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
