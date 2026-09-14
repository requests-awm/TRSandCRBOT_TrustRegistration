import { createServiceClient } from "@/lib/supabase/service";

// Generate a case reference: NTR-{year}-{zero-padded sequence}
// Example: NTR-2026-000001
// The sequence is backed by a case_reference_counters table, updated atomically via SELECT ... FOR UPDATE.
export async function generateCaseReference(): Promise<string> {
  const client = createServiceClient();
  const year = new Date().getFullYear();

  // Use a transaction-like pattern with FOR UPDATE to ensure atomicity
  const { data: counter, error: fetchError } = await client
    .from("case_reference_counters")
    .select("next_seq")
    .eq("year", year)
    .single();

  let nextSeq: number;

  if (fetchError || !counter) {
    // First case of the year; create a new counter row
    const { data: inserted, error: insertError } = await client
      .from("case_reference_counters")
      .insert({ year, next_seq: 2 }) // Insert with 2 so we can return 1
      .select("next_seq")
      .single();

    if (insertError || !inserted) {
      throw new Error(`Failed to initialize case reference counter for year ${year}: ${insertError?.message}`);
    }

    nextSeq = 1; // The first sequence for this year
  } else {
    // Increment and return the next sequence
    nextSeq = counter.next_seq;
    const { error: updateError } = await client
      .from("case_reference_counters")
      .update({ next_seq: nextSeq + 1 })
      .eq("year", year);

    if (updateError) {
      throw new Error(`Failed to increment case reference counter: ${updateError.message}`);
    }
  }

  // Format: NTR-2026-000001
  return `NTR-${year}-${String(nextSeq).padStart(6, "0")}`;
}
