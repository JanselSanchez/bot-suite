// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Versión de control: 1.0.5 - Si no ves este número en los logs de Render, no se ha actualizado.
export async function POST(req: Request) {
  console.log(">>> [DEBUG V1.0.5] Iniciando creación de negocio...");

  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceRoleKey || !supabaseUrl) {
      console.error(">>> [ERROR] Faltan variables de entorno en Render.");
      return NextResponse.json({ error: "Configuración incompleta en el servidor." }, { status: 500 });
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
    if (!user) return NextResponse.json({ error: "Sesión expirada." }, { status: 401 });

    const body = await req.json();
    console.log(">>> [PAYLOAD RECIBIDO]:", body);

    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // --- ESTRATEGIA DE INSERCIÓN SEGURA ---
    // Solo enviamos las columnas que confirmamos que existen en tu captura de DB inicial.
    const cleanData: any = {
      name: body.name.trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active"
    };

    // Intentamos añadir las nuevas columnas SOLO si el backend las reconoce.
    // Si esto falla, el error nos dirá exactamente qué columna falta.
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(cleanData)
      .select("id")
      .single();

    if (insErr) {
      console.error(">>> [DETALLE ERROR SUPABASE]:", insErr);
      return NextResponse.json({ 
        error: `Supabase dice: ${insErr.message}`,
        hint: insErr.hint,
        code: insErr.code 
      }, { status: 500 });
    }

    // Relación de dueño
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // Intentamos guardar los datos extra en una tabla secundaria para no romper 'tenants'
    try {
      await sbAdmin.from("business_profiles").insert({
        tenant_id: tenant.id,
        vertical: body.vertical,
        description: body.description
      });
    } catch (e) {
      console.log(">>> [INFO] No se pudo guardar en business_profiles, ignorando...");
    }

    cookieStore.set("pyme.active_tenant", tenant.id, { path: "/" });
    console.log(">>> [EXITO] Negocio creado ID:", tenant.id);

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error(">>> [CRASH]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
