"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

// Supabase email/password sign-in. Inactive in placeholder mode (NEXT_PUBLIC_DATA_SOURCE=mock)
// because no Supabase project is configured yet. The proxy sends anonymous visitors here with ?next=.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const nextPath = useSearchParams().get("next") ?? "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const mockMode = process.env.NEXT_PUBLIC_DATA_SOURCE !== "http";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push(nextPath.startsWith("/") ? nextPath : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">AWM</div>
          <h1 className="text-xl font-semibold text-slate-900">Trust Registration</h1>
        </div>
        <Card>
          {mockMode ? (
            <div className="space-y-3">
              <Alert tone="warning">Placeholder mode is on. No sign-in is needed; pick a role from the sidebar instead.</Alert>
              <Button className="w-full" onClick={() => router.push("/dashboard")}>
                Continue to dashboard
              </Button>
            </div>
          ) : !configured ? (
            <Alert tone="error">Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.</Alert>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <Field label="Email" required>
                <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <Field label="Password" required>
                <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              {error && <Alert tone="error">{error}</Alert>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
