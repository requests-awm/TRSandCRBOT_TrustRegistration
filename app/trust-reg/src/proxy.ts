import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authMode, dataSource, supabaseAnonKey, supabaseUrl } from "@/server/env";

// Session guard for the app pages. Runs before every page render (API routes check auth themselves).
// - Anonymous visitors to /dashboard, /cases, /audit are sent to /login.
// - Signed-in visitors to /login are sent to /dashboard.
// - Refreshes the Supabase session cookie on the way through.
// Skipped in placeholder mode (NEXT_PUBLIC_DATA_SOURCE=mock) and header-based dev auth (AUTH_MODE=dev).
export async function proxy(request: NextRequest) {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  const guardActive = dataSource() === "http" && authMode() !== "dev" && Boolean(url && anonKey);

  if (!guardActive) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url!, anonKey!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("next") ?? "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/", "/login", "/dashboard/:path*", "/cases/:path*", "/audit/:path*", "/reports/:path*"],
};
