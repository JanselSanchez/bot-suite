// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  console.log("🚀 [API] Recibida solicitud de creación de negocio...");

  try {
    // ---------------------------------------------------------
    // 1. DIAGNÓSTICO DE VARIABLES DE ENTORNO (¡AQUÍ ESTÁ EL ERROR!)
    // ---------------------------------------------------------
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    console.log("🔍 Verificando llaves en Render:");
    console.log("- URL:", supabaseUrl ? "✅ OK" : "❌ FALTA");
    console.log("- SERVICE_ROLE:", serviceRoleKey ? "✅ OK" : "❌ FALTA (Causa del Error 500)");

    if (!serviceRoleKey) {
      return NextResponse.json({ 
        ok: false, 
        error: "FATAL: Falta la variable SUPABASE_SERVICE_ROLE_KEY en la configuración de Render." 
      }, { status: 500 });
    }

    // ---------------------------------------------------------
    // 2. Lógica Normal
    // ---------------------------------------------------------
    const cookieStore = cookies();
    
    // Auth Check
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          async get(name: string) { return (await cookieStore).get(name)?.value; },
          async set(name: string, value: string, options: any) { try { (await cookieStore).set({ name, value, ...options }); } catch {} },
          async remove(name: string, options: any) { try { (await cookieStore).set({ name, value: "", ...options }); } catch {} },
        },
      }
    );
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ ok: false, error: "Sesión expirada (401)" }, { status: 401 });
    }

    // Leer Body
    let body: any = {};
    try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

    const name = (body?.name ?? "").toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: "Nombre obligatorio" }, { status: 400 });

    // Preparar campos opcionales
    const rawPhone = (body?.phone ?? "").toString().trim();
    const phone = rawPhone ? (rawPhone.startsWith('whatsapp:') ? rawPhone : `whatsapp:+${rawPhone.replace(/\D/g, "")}`) : null;
    const vertical = (body?.vertical ?? "general").toString().trim();
    const description = (body?.description ?? "").toString().trim() || null;
    const notification_email = (body?.notification_email ?? "").toString().trim() || null;
    const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

    // Crear cliente Admin
    const sbAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!, // Ya verificamos que existe arriba
      { auth: { persistSession: false } }
    );

    console.log("💾 Intentando guardar en DB...");

    // Insertar
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert({
        name,
        timezone,
        phone,
        status: "active",
        owner_id: user.id,
        vertical,
        description,
        notification_email, 
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error Supabase:", insErr);
      return NextResponse.json({ 
        ok: false, 
        error: `Error Base de Datos: ${insErr.message}` 
      }, { status: 500 });
    }

    // Crear relación owner
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // Cookie
    (await cookies()).set("pyme.active_tenant", tenant.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    console.log("✅ Éxito total. Tenant ID:", tenant.id);
    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 CRASH NO CONTROLADO:", error);
    return NextResponse.json({ 
      ok: false, 
      error: `Error Interno: ${error.message}` 
    }, { status: 500 });
  }
}
