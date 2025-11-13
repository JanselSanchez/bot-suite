// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookieStore = cookies();

  // SSR client que LEE y ESCRIBE cookies del request/respuesta
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async get(name: string) {
          return (await cookieStore).get(name)?.value;
        },
        async set(name: string, value: string, options: any) {
          (await cookieStore).set({ name, value, ...options });
        },
        async remove(name: string, options: any) {
          (await cookieStore).set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (!user || userErr) {
    return NextResponse.json({ ok: false, error: "not-auth" }, { status: 401 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {}

  const name = (body?.name ?? "").toString().trim();
  const phone = (body?.phone ?? "").toString().trim();
  const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Nombre obligatorio" },
      { status: 400 }
    );
  }

  // Admin client para ESCRIBIR (SERVICE ROLE)
  const sbAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Insert en tenants
  const { data: tenant, error: insErr } = await sbAdmin
    .from("tenants")
    .insert({
      name,
      timezone,
      phone: phone ? `whatsapp:+${phone.replace(/\D/g, "")}` : null,
      status: "active",
      owner_id: user.id, // si tienes esta columna
    })
    .select("id")
    .single();

  if (insErr || !tenant) {
    return NextResponse.json(
      { ok: false, error: insErr?.message ?? "No se pudo crear" },
      { status: 500 }
    );
  }

  // Relación de membresía (si existe)
  await sbAdmin
    .from("tenant_members")
    .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

  // Fija cookie del tenant activo
  (await
        // Fija cookie del tenant activo
        cookies()).set("pyme.active_tenant", tenant.id, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true, tenantId: tenant.id });
}
