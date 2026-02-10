// middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // 1. PRIORIDAD ABSOLUTA: Si es API, estática o assets, salir de inmediato sin tocar NADA.
  // Esto evita que Supabase intente inicializarse en rutas que no debe.
  if (
    path.startsWith("/api") || 
    path.startsWith("/_next") || 
    path.includes(".") // Excluye archivos como favicon.ico, etc.
  ) {
    return NextResponse.next();
  }

  // 2. Rutas públicas directas
  if (path.startsWith("/connect")) {
    return NextResponse.next();
  }

  // Creamos una respuesta base
  let response = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

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
            req.cookies.set(name, value); // Actualiza la petición
            response.cookies.set(name, value, options); // Actualiza la respuesta
          });
        },
      },
    }
  );

  // IMPORTANTE: Solo llamar a getUser en rutas que realmente requieren auth (dashboard o login)
  // No lo llames para cada ruta del sitio para no gastar recursos ni bloquear el body.
  const isDashboard = path.startsWith("/dashboard");
  const isLogin = path === "/login";

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

// El Matcher debe ser lo más específico posible para no atrapar peticiones POST de la API
export const config = {
  matcher: [
    /*
     * Coincide con todas las rutas excepto:
     * - api (rutas de backend)
     * - _next/static (archivos estáticos)
     * - _next/image (optimización de imágenes)
     * - favicon.ico (icono del sitio)
     */
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
