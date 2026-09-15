import { createClient } from "@supabase/supabase-js";
import { env } from "@/server/env";

// Read-only client for public.insightly_contacts.
// If INSIGHTLY_SUPABASE_* env vars are set, uses a separate project; otherwise the same project as trust_reg.
export function createInsightlyClient() {
  const url = env("INSIGHTLY_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("INSIGHTLY_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials for Insightly client. Check INSIGHTLY_SUPABASE_URL and INSIGHTLY_SUPABASE_ANON_KEY."
    );
  }

  return createClient(url, key);
}
