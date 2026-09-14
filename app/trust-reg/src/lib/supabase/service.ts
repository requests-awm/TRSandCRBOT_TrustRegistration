import { createClient } from "@supabase/supabase-js";

// Service-role client scoped to trust_reg schema only.
// Used on the server-side for all mutating operations and privileged reads.
// NEVER expose this key to the client/browser.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: {
        schema: "trust_reg",
      },
    }
  );
}
