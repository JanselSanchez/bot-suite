// src/app/(auth)/signout/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function doSignout(req: Request) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    }
  );

  // Cerrar sesión en Supabase
  await supabase.auth.signOut();

  // Borrar tenant activo
  cookieStore.set("pyme.active_tenant", "", {
    path: "/",
    maxAge: 0,
  });

  // ⬅️ OJO: aquí es /login, SIN /auth
  const url = new URL(req.url);
  const loginUrl = new URL("/login", url.origin);

  return NextResponse.redirect(loginUrl);
}

// Acepta GET y POST
export async function GET(req: Request) {
  return doSignout(req);
}

export async function POST(req: Request) {
  return doSignout(req);
}
