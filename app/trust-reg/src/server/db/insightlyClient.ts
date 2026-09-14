import { createClient } from "@supabase/supabase-js";

// Read-only client for public.insightly_contacts.
// If INSIGHTLY_SUPABASE_* env vars are set, uses a separate project (the shared AWM instance).
// Otherwise defaults to the local/development instance.
export function createInsightlyClient() {
  const url = process.env.INSIGHTLY_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.INSIGHTLY_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing Supabase credentials for Insightly client. Check INSIGHTLY_SUPABASE_URL and INSIGHTLY_SUPABASE_ANON_KEY."
    );
  }

  return createClient(url, key);
}
