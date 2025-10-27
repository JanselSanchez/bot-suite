import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs";

export async function middleware(req: NextRequest) {
  // Respuesta mutable para que el helper pueda escribir cookies al refrescar tokens
  const res = NextResponse.next({ request: { headers: req.headers } });

  // ❌ sin cast
  const supabase = createMiddlewareClient({ req, res });

  // Sincroniza/renueva la sesión (puede setear cookies)
  await supabase.auth.getSession();

  // Protege /dashboard/**
  if (req.nextUrl.pathname.startsWith("/dashboard")) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirectedFrom", req.nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = { matcher: ["/dashboard/:path*"] };
