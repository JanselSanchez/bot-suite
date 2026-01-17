import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  // Manejo de errores para evitar que la petición se quede colgada
  try {
    const { event, session } = await req.json();
    const cookieStore = await cookies();
    const res = NextResponse.json({ ok: true });

    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
          },
          setAll(cookiesList) {
            cookiesList.forEach(({ name, value, options }) => {
              res.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
      await sb.auth.setSession(session);
    }
    
    if (event === "SIGNED_OUT") {
      await sb.auth.signOut();
    }

    return res;
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Auth callback failed" }, { status: 500 });
  }
}
