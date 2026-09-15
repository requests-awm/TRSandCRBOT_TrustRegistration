import { createClient } from "@supabase/supabase-js";
import { requireEnv } from "@/server/env";

// Service-role client scoped to the trust_reg schema. Server only: all mutations and privileged reads.
// NEVER expose this key to the browser. Values are read at request time so one image serves every environment.
export function createServiceClient() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: {
      schema: "trust_reg",
    },
  });
}
