import { createServiceClient } from "@/lib/supabase/service";

// Case reference: NTR-{year}-{six-digit sequence}, e.g. NTR-2026-000001.
// Allocation happens inside trust_reg.next_case_reference() (supabase/sql/001_rls_and_constraints.sql)
// with a single upsert, so two requests landing at the same moment cannot receive the same number.
export async function generateCaseReference(): Promise<string> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("next_case_reference");

  if (error) {
    throw new Error(`Failed to allocate case reference: ${error.message}. Has 001_rls_and_constraints.sql been applied?`);
  }
  if (typeof data !== "string" || !/^NTR-\d{4}-\d{6}$/.test(data)) {
    throw new Error(`Unexpected case reference from database: ${String(data)}`);
  }
  return data;
}
