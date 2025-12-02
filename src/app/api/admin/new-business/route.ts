// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const cookieStore = cookies();

  // SSR client para validar usuario
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

  // 1. Extraemos los campos existentes
  const name = (body?.name ?? "").toString().trim();
  const phone = (body?.phone ?? "").toString().trim();
  const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

  // 2. EXTRAEMOS LOS NUEVOS CAMPOS (Vertical y Descripción)
  // Si no llega vertical, ponemos "general". Si no llega descripción, ponemos null.
  const vertical = (body?.vertical ?? "general").toString().trim();
  const description = (body?.description ?? "").toString().trim() || null;

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

  // 3. Insertamos en tenants INCLUYENDO los nuevos campos
  const { data: tenant, error: insErr } = await sbAdmin
    .from("tenants")
    .insert({
      name,
      timezone,
      phone: phone ? `whatsapp:+${phone.replace(/\D/g, "")}` : null,
      status: "active",
      owner_id: user.id,
      vertical,      // <--- GUARDAMOS EL TIPO DE NEGOCIO
      description,   // <--- GUARDAMOS LA DESCRIPCIÓN
    })
    .select("id")
    .single();

  if (insErr || !tenant) {
    console.error("Error creando tenant:", insErr); // Log para debug en servidor
    return NextResponse.json(
      { ok: false, error: insErr?.message ?? "No se pudo crear" },
      { status: 500 }
    );
  }

  // Relación de membresía
  await sbAdmin
    .from("tenant_members")
    .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

  // Fija cookie del tenant activo
  (await cookies()).set("pyme.active_tenant", tenant.id, {
    path: "/",
    httpOnly: false,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });

  return NextResponse.json({ ok: true, tenantId: tenant.id });
}