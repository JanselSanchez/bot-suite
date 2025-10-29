import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const tenantId: string | undefined = body?.tenantId;

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

  // 1) Usuario actual
  const { data: { user }, error: userErr } = await sb.auth.getUser();
  if (userErr || !user) {
    return NextResponse.json({ ok: false, error: "UNAUTH" }, { status: 401 });
  }

  // 2) Verifica si ya existe relación
  const { data: existing, error: exErr } = await sb
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (exErr) {
    return NextResponse.json({ ok: false, error: exErr.message }, { status: 500 });
  }

  if (!existing) {
    // Inserta relación (rol por defecto: 'owner' o el que uses)
    const { error: insErr } = await sb
      .from("tenant_users")
      .insert([{ tenant_id: tenantId, user_id: user.id, role: "owner" }]);

    if (insErr) {
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
