import { createClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { requireEnv } from "@/server/env";
import type { UserRole } from "@/server/domain/types";
import { ROLE_LABEL } from "@/lib/labels";

// Lookups that are not part of the registration workflow itself:
//   * clients from the company master public.insightly_contacts (read-only, per shared-DB rules)
//   * people from trust_reg.profiles, for owner pickers and name display

export interface ClientSearchResult {
  insightlyId: string;
  displayName: string;
  adviser: string | null;
  email: string | null;
}

export interface ClientSearchResponse {
  // false when the shared table is not reachable (no grant yet, different project) so the UI can
  // fall back to manual entry without treating it as an error.
  available: boolean;
  results: ClientSearchResult[];
}

export interface ProfileSummary {
  id: string;
  fullName: string;
  role: UserRole;
  wmTeam: string | null;
}

// Service-role client on the default (public) schema. Separate instance because supabase-js pins one
// schema per client and embedded joins never cross schemas.
function publicClient() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

const CONTACTS = "insightly_contacts";
const ID_COLS = ["client_id", "contact_id", "insightly_id", "id"];
const FIRST_COLS = ["first_name", "firstname", "given_name"];
const LAST_COLS = ["last_name", "lastname", "surname", "family_name"];
const ADVISER_COLS = ["appointed_adviser", "adviser", "advisor", "appointed_advisor"];
const EMAIL_COLS = ["email_address", "email", "primary_email"];

interface ContactColumns {
  id: string;
  first: string | null;
  last: string | null;
  adviser: string | null;
  email: string | null;
}

// The shared table is owned by another team and its columns have drifted from the written reference,
// so discover them once per process instead of hard-coding.
let columnsPromise: Promise<ContactColumns | null> | null = null;
async function contactColumns(): Promise<ContactColumns | null> {
  columnsPromise ??= (async () => {
    const { data, error } = await publicClient().from(CONTACTS).select("*").limit(1);
    if (error) {
      console.warn(`${CONTACTS} not reachable: ${error.message}`);
      columnsPromise = null; // try again next time; the grant may arrive later
      return null;
    }
    const keys = new Set(Object.keys(data?.[0] ?? {}));
    const pick = (cands: string[]) => cands.find((c) => keys.has(c)) ?? null;
    const id = pick(ID_COLS);
    if (!id) {
      console.warn(`${CONTACTS}: no id column found among ${ID_COLS.join(", ")}; columns: ${[...keys].join(", ")}`);
      return null;
    }
    return { id, first: pick(FIRST_COLS), last: pick(LAST_COLS), adviser: pick(ADVISER_COLS), email: pick(EMAIL_COLS) };
  })();
  return columnsPromise;
}

const clean = (s: string) => s.replace(/[,%()\\]/g, " ").trim();

export async function searchClients(q: string, limit = 10): Promise<ClientSearchResponse> {
  const term = q.trim();
  if (term.length < 2) return { available: true, results: [] };

  const cols = await contactColumns();
  if (!cols) return { available: false, results: [] };

  const selected = [cols.id, cols.first, cols.last, cols.adviser, cols.email].filter((c): c is string => !!c);
  let query = publicClient().from(CONTACTS).select(selected.join(", ")).limit(limit);

  if (/^\d+$/.test(term)) {
    query = query.eq(cols.id, Number(term));
  } else if (term.includes(",") && cols.last) {
    // "Surname, First" as typed in the request form
    const [last, first] = term.split(",").map(clean);
    query = query.ilike(cols.last, `${last}%`);
    if (first && cols.first) query = query.ilike(cols.first, `${first}%`);
  } else {
    const t = clean(term);
    const ors = [cols.last, cols.first, cols.email].filter((c): c is string => !!c).map((c) => `${c}.ilike.%${t}%`);
    if (ors.length === 0) return { available: true, results: [] };
    query = query.or(ors.join(","));
  }
  if (cols.last) query = query.order(cols.last, { ascending: true });

  const { data, error } = await query;
  if (error) {
    console.warn(`${CONTACTS} lookup failed: ${error.message}`);
    return { available: false, results: [] };
  }

  return {
    available: true,
    results: ((data ?? []) as unknown as Array<Record<string, unknown>>).map((c) => {
      const str = (col: string | null) => (col && c[col] != null ? String(c[col]).trim() : "");
      const last = str(cols.last);
      const first = str(cols.first);
      return {
        insightlyId: String(c[cols.id]),
        displayName: [last, first].filter(Boolean).join(", ") || String(c[cols.id]),
        adviser: str(cols.adviser) || null,
        email: str(cols.email) || null,
      };
    }),
  };
}

export async function listProfiles(roles?: UserRole[]): Promise<ProfileSummary[]> {
  const client = createServiceClient();
  let query = client.from("profiles").select("id, role, full_name, wm_team, is_active").eq("is_active", true);
  if (roles && roles.length > 0) query = query.in("role", roles);
  const { data, error } = await query.order("full_name", { ascending: true });
  if (error) throw new Error(`Failed to list profiles: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id,
    fullName: p.full_name ?? ROLE_LABEL[p.role as UserRole],
    role: p.role as UserRole,
    wmTeam: p.wm_team ?? null,
  }));
}
