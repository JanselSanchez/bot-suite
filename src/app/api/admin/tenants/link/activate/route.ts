import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  try {
    const { tenantId } = await req.json();
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const sb = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
          },
          setAll(list) {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options);
            }
          },
        },
      }
    );

    // Verificar que el tenant exista (y opcionalmente que esté activo)
    const { data, error } = await sb
      .from("tenants")
      .select("id, status")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "TENANT_NOT_FOUND" }, { status: 404 });
    if (data.status && data.status !== "active") {
      return NextResponse.json({ ok: false, error: "TENANT_INACTIVE" }, { status: 400 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set("active_tenant_id", data.id, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "UNHANDLED", detail: e?.message || String(e) }, { status: 500 });
  }
}
