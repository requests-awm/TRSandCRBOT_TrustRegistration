import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireEnv } from "@/server/env";

// Cookie-based session client for auth-aware reads (who is signed in). Runtime env, never inlined.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options as CookieOptions));
        } catch {
          // Called from a Server Component; the proxy refreshes the session cookie instead.
        }
      },
    },
  });
}
