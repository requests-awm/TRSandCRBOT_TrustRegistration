import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { publicOrigin } from "@/server/http/origin";

// POST /auth/signout — clears the Supabase session cookie and returns to the login page.
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${publicOrigin(req)}/login`, { status: 303 });
}
