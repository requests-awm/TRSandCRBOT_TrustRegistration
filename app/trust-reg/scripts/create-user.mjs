#!/usr/bin/env node
// Create (or update) an application user: a Supabase Auth account plus its trust_reg.profiles row.
//
//   node scripts/create-user.mjs <email> <role> "<Full Name>" ["<WM team>"] [--password <pw>]
//
//   roles: wm_requester | aep_processor | aep_reviewer | compliance_reviewer | administrator | auditor
//   WM team is required for wm_requester (case visibility is scoped by team).
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local. Prints a temporary
// password once when it generates one; the person should change it after first sign-in.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const ROLES = ["wm_requester", "aep_processor", "aep_reviewer", "compliance_reviewer", "administrator", "auditor"];

const args = process.argv.slice(2);
const pwIdx = args.indexOf("--password");
const password = pwIdx >= 0 ? args.splice(pwIdx, 2)[1] : null;
const [email, role, fullName, wmTeam] = args;

if (!email || !role || !fullName) {
  console.error('usage: node scripts/create-user.mjs <email> <role> "<Full Name>" ["<WM team>"] [--password <pw>]');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`role must be one of: ${ROLES.join(", ")}`);
  process.exit(1);
}
if (role === "wm_requester" && !wmTeam) {
  console.error("wm_requester needs a WM team as the 4th argument");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const trustReg = createClient(url, serviceKey, { db: { schema: "trust_reg" } });

const tempPassword = password ?? randomBytes(12).toString("base64url").replace(/[-_]/g, "x") + "!7";

// Find an existing auth user by email, otherwise create one (email pre-confirmed: no verification mail needed).
let userId;
let created = false;
const { data: page, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;
const existing = page.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (existing) {
  userId = existing.id;
  if (password) {
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) throw error;
  }
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  userId = data.user.id;
  created = true;
}

const { error: profileError } = await trustReg.from("profiles").upsert(
  { id: userId, role, full_name: fullName, wm_team: wmTeam ?? null, is_active: true },
  { onConflict: "id" }
);
if (profileError) throw profileError;

console.log(`${created ? "Created" : "Updated"} ${email}`);
console.log(`  user id : ${userId}`);
console.log(`  role    : ${role}${wmTeam ? `  (team: ${wmTeam})` : ""}`);
if (created || password) {
  console.log(`  password: ${created ? tempPassword : password}   <- temporary, change after first sign-in`);
} else {
  console.log("  password: unchanged (pass --password to reset)");
}
