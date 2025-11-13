import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET() {
  // cookies() NO es async
  const cookieStore = await cookies();

  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          // asegúrate de propagar path para evitar duplicados por ruta
          cookieStore.set({ name, value, path: "/", ...options });
        },
        remove(name: string, options: any) {
          // expira explícitamente
          cookieStore.set({
            name,
            value: "",
            path: "/",
            expires: new Date(0),
            maxAge: 0,
            ...options,
          });
        },
      },
    }
  );

  try {
    const { data, error } = await sb
      .from("tenants")
      .select("id,name,timezone,status")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    const active = cookieStore.get("pyme.active_tenant")?.value || null;

    return NextResponse.json({ ok: true, tenants: data, active }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
