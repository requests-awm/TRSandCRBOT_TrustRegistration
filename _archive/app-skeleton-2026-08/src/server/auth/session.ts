import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { AuthUser, UserRole } from "./roles";

// Get the current authenticated user's session and role information.
// Called by API routes to enforce authorization.
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const supabase = await createClient();

    // Get the session from the JWT in cookies
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    // Fetch the user's role from trust_reg.profiles
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
      fullName: profile.full_name,
      wmTeam: profile.wm_team,
      isActive: profile.is_active,
    };
  } catch (err) {
    console.error("Error fetching current user:", err);
    return null;
  }
}
