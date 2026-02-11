// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1) SALIDA TEMPRANA: API + assets + next internals
  if (
    path.startsWith("/api") ||
    path.startsWith("/_next") ||
    path.includes(".")
  ) {
    return NextResponse.next();
  }

  // 2) Rutas públicas
  if (path.startsWith("/connect")) {
    return NextResponse.next();
  }

  const response = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // ✅ SOLO setear en response (NO en req)
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const isDashboard = path.startsWith("/dashboard");
  const isLogin = path === "/login";

  if (isDashboard || isLogin) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (isLogin && user) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }

    if (isDashboard && !user) {
      const url = new URL("/login", req.url);
      url.searchParams.set("redirectedFrom", path);
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/", "/login", "/dashboard/:path*", "/connect/:path*"],
};
