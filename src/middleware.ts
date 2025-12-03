import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next();

  // 1. EXCEPCIONES PÚBLICAS (¡CRUCIAL!)
  // Si la ruta es para conectar el bot o la API del bot, dejamos pasar sin chequear sesión.
  const path = req.nextUrl.pathname;
  if (
    path.startsWith("/connect") ||      // Pantalla pública del QR
    path.startsWith("/api/wa")          // API que usa la pantalla pública
  ) {
    return res;
  }

  // 2. Configuración del Cliente Supabase para Middleware
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            req.cookies.set(name, value)
          );
          res = NextResponse.next({
            request: { headers: req.headers },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // 3. Verificar Sesión
  // Usamos getUser() en lugar de getSession() por seguridad en middleware (recomendación oficial de Supabase)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 4. Lógica de Protección de Rutas

  // Si intenta ir al login y ya está logueado -> Dashboard
  if (path === "/login" && user) {
    const url = req.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Si intenta ir al dashboard y NO está logueado -> Login
  if (path.startsWith("/dashboard") && !user) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", path);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Matcher actualizado para incluir las rutas que queremos filtrar explícitamente
  // Se excluyen estáticos (_next, imagenes, favicon)
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};