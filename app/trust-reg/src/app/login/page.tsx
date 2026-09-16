"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import Image from "next/image";
import { createBrowserClient } from "@supabase/ssr";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { publicConfig } from "@/lib/publicConfig";

// Sign-in page. AWM staff use their Google account (the shared Supabase project's provider); the
// email/password form remains for seeded and service accounts. Inactive in placeholder mode.
// The proxy sends anonymous visitors here with ?next=; /auth/callback sends failures back with ?error=.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const ERROR_TEXT: Record<string, string> = {
  no_access:
    "Your AWM account signed in, but it has not been given a role in Trust Registration yet. Ask an administrator to add you.",
};

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = params.get("next") ?? "/dashboard";
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
  const urlError = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(urlError ? ERROR_TEXT[urlError] ?? urlError : null);
  const [busy, setBusy] = useState(false);

  const cfg = publicConfig();
  const configured = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const mockMode = cfg.dataSource !== "http";

  const supabase = () => createBrowserClient(cfg.supabaseUrl, cfg.supabaseAnonKey);

  const signInWithGoogle = async () => {
    setError(null);
    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, queryParams: { prompt: "select_account", hd: "ascotwm.com" } },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push(safeNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/awm-logo.png" alt="Ascot Wealth Management" width={1158} height={546} priority className="h-16 w-auto" />
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
            <div className="space-y-4">
              {error && <Alert tone="error">{error}</Alert>}
              <Button className="w-full" onClick={signInWithGoogle} disabled={busy}>
                <GoogleMark />
                {busy ? "Redirecting…" : "Sign in with your AWM Google account"}
              </Button>
              <p className="text-center text-xs text-slate-500">Use your @ascotwm.com account. Access is granted per person by an administrator.</p>

              {!showPassword ? (
                <button type="button" className="w-full text-center text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setShowPassword(true)}>
                  Sign in with email and password instead
                </button>
              ) : (
                <form onSubmit={submitPassword} className="space-y-3 border-t border-slate-200 pt-4">
                  <Field label="Email" required>
                    <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </Field>
                  <Field label="Password" required>
                    <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <Button type="submit" variant="secondary" className="w-full" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 48 48" className="shrink-0">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.5 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.4 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v8.1h12.7c-.3 2.1-1.7 5.3-4.8 7.4l7.4 5.7c4.4-4.1 7.2-10.1 7.2-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.6-4-13.5-9.7l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
