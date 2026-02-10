import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceRoleKey || !supabaseUrl) {
      return NextResponse.json({ error: "Faltan variables de entorno" }, { status: 500 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }); },
        remove(name: string, options: any) { cookieStore.set({ name, value: "", ...options }); },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await req.json();

    // 1. EXTRAEMOS SOLO LO QUE LA TABLA 'tenants' SOPORTA SEGÚN TU IMAGEN
    // Si intentas insertar 'vertical' o 'description' aquí, dará Error 500.
    const tenantData = {
      name: (body.name || "Sin nombre").toString().trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active"
    };

    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    console.log("💾 Insertando datos limpios en tenants:", tenantData);

    // 2. INSERTAR EN TENANTS
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantData)
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error Supabase:", insErr);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // 3. RELACIÓN DE MIEMBRO
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // 4. GUARDAR DATOS EXTRA (Vertical/Descripción) EN OTRA TABLA
    // Solo si tienes la tabla 'business_profiles' creada.
    try {
      await sbAdmin.from("business_profiles").insert({
        tenant_id: tenant.id,
        vertical: body.vertical || "general",
        description: body.description || ""
      });
    } catch (e) {
      console.log("Omitiendo perfiles: tabla no existe o error menor.");
    }

    cookieStore.set("pyme.active_tenant", tenant.id, { path: "/" });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 Crash:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
