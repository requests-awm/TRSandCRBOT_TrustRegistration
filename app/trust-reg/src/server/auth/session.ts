import { headers } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { AuthUser } from "./roles";
import { USER_ROLES, type UserRole } from "@/server/domain/types";

// Resolves the calling user for API routes.
//
// AUTH_MODE=supabase (default): reads the Supabase session cookie, then the role from trust_reg.profiles.
// AUTH_MODE=dev: PLACEHOLDER for local work before the database exists. The caller picks a role with the
//   x-dev-role header (and optionally x-dev-user-id). Refused outright in production builds.
export async function getCurrentUser(): Promise<AuthUser | null> {
  if (process.env.AUTH_MODE === "dev") {
    return getDevUser();
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return null;

    const serviceClient = createServiceClient();
    const { data: profile, error } = await serviceClient
      .from("profiles")
      .select("role, full_name, wm_team, is_active")
      .eq("id", user.id)
      .single();

    if (error || !profile) {
      console.error("Failed to fetch user profile:", error);
      return null;
    }

    return {
      id: user.id,
      email: user.email || "",
      role: profile.role as UserRole,
      fullName: profile.full_name ?? undefined,
      wmTeam: profile.wm_team ?? undefined,
      isActive: profile.is_active,
    };
  } catch (err) {
    console.error("Error fetching current user:", err);
    return null;
  }
}

async function getDevUser(): Promise<AuthUser | null> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_MODE=dev is not permitted in production");
  }
  const h = await headers();
  const role = h.get("x-dev-role") ?? process.env.DEV_DEFAULT_ROLE ?? "administrator";
  if (!(USER_ROLES as readonly string[]).includes(role)) return null;

  const id = h.get("x-dev-user-id") ?? `00000000-0000-4000-8000-${roleSuffix(role as UserRole)}`;
  return {
    id,
    email: `${role}@dev.local`,
    role: role as UserRole,
    fullName: `Dev ${role.replace(/_/g, " ")}`,
    wmTeam: role === "wm_requester" ? h.get("x-dev-wm-team") ?? "WM Team A" : undefined,
    isActive: true,
  };
}

function roleSuffix(role: UserRole): string {
  const index = USER_ROLES.indexOf(role) + 1;
  return String(index).padStart(12, "0");
}
