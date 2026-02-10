import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // CLONAMOS la petición para evitar el error "body is disturbed"
  const reqClone = req.clone();

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

    // Verificamos usuario
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // Leemos el JSON de la petición clonada
    const body = await reqClone.json();

    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Filtramos SOLO las columnas que existen en la tabla 'tenants' (según tu DB)
    const tenantPayload = {
      name: body.name.trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active"
    };

    // 1. Insertar negocio
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // 2. Relación de dueño
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // 3. Intentar guardar vertical/descripción en tabla secundaria (si existe)
    try {
      await sbAdmin.from("business_profiles").insert({
        tenant_id: tenant.id,
        vertical: body.vertical || "general",
        description: body.description || ""
      });
    } catch (e) {
      console.log("Tabla business_profiles no encontrada, ignorando datos extra.");
    }

    cookieStore.set("pyme.active_tenant", tenant.id, { path: "/" });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("Error en servidor:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
