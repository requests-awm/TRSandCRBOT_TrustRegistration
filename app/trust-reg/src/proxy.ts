import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Session guard for the app pages. Runs before every page render (API routes check auth themselves).
// - Anonymous visitors to /dashboard, /cases, /audit are sent to /login.
// - Signed-in visitors to /login are sent to /dashboard.
// - Refreshes the Supabase session cookie on the way through.
// Skipped in placeholder mode (NEXT_PUBLIC_DATA_SOURCE=mock) and header-based dev auth (AUTH_MODE=dev).
export async function proxy(request: NextRequest) {
  const guardActive =
    process.env.NEXT_PUBLIC_DATA_SOURCE === "http" &&
    process.env.AUTH_MODE !== "dev" &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  if (!guardActive) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
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
  matcher: ["/", "/login", "/dashboard/:path*", "/cases/:path*", "/audit/:path*"],
};
