import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// OAuth return leg. Supabase redirects here with ?code=...; we exchange it for a session cookie,
// check the person has a trust_reg.profiles row (their role), and send them on.
// Someone with a valid AWM Google account but no profile is signed out again and told to ask an administrator.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const nextParam = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";
  const origin = req.nextUrl.origin;

  if (!code) {
    const err = req.nextUrl.searchParams.get("error_description") ?? "Sign-in was cancelled";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(err)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error?.message ?? "Sign-in failed")}`);
  }

  const { data: profile } = await createServiceClient()
    .from("profiles")
    .select("id, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=no_access`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
