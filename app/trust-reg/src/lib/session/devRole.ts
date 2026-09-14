import { USER_ROLES, type UserRole } from "@/server/domain/types";

const KEY = "trust_reg.dev_role";

// The role the local developer is impersonating. Only meaningful in mock or AUTH_MODE=dev.
export function readDevRole(): UserRole {
  if (typeof window === "undefined") return "administrator";
  try {
    const v = window.localStorage.getItem(KEY);
    if (v && (USER_ROLES as readonly string[]).includes(v)) return v as UserRole;
  } catch {
    // storage unavailable
  }
  return "administrator";
}

export function writeDevRole(role: UserRole) {
  try {
    window.localStorage.setItem(KEY, role);
  } catch {
    // storage unavailable
  }
}

export const DEV_USER_IDS: Record<UserRole, string> = Object.fromEntries(
  USER_ROLES.map((r, i) => [r, `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`])
) as Record<UserRole, string>;
