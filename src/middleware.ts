// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1. PRIORIDAD ABSOLUTA: Si es API, estática o assets, salir de inmediato sin tocar NADA.
  // Esto garantiza que el body de las peticiones POST llegue intacto a tus rutas.
  if (
    path.startsWith("/api") || 
    path.startsWith("/_next") || 
    path.includes(".") 
  ) {
    return NextResponse.next();
  }

  // 2. Rutas públicas directas
  if (path.startsWith("/connect")) {
    return NextResponse.next();
  }

  // Creamos la respuesta base
  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  // Inicializamos Supabase solo para rutas que no son de la API
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const isDashboard = path.startsWith("/dashboard");
  const isLogin = path === "/login";

  // Solo ejecutamos getUser si estamos en rutas protegidas o de acceso
  if (isDashboard || isLogin) {
    const { data: { user } } = await supabase.auth.getUser();

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

// Configuración del Matcher: Ahora es selectivo para NO interceptar la API
export const config = {
  matcher: [
    /*
     * Coincidimos solo con rutas que SI necesitan middleware.
     * Al excluir explícitamente el patrón de la API aquí, 
     * Next.js no bloqueará el body en las peticiones de tus negocios.
     */
    "/",
    "/login",
    "/dashboard/:path*",
    "/connect/:path*",
  ],
};
