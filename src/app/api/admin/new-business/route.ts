// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  console.log("🚀 [API] Iniciando creación de negocio...");

  try {
    // 1. CHEQUEO DE SEGURIDAD DE VARIABLES (¡Aquí suele estar el error 500!)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("FATAL: Falta la variable SUPABASE_SERVICE_ROLE_KEY en Render.");
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      throw new Error("FATAL: Falta la variable NEXT_PUBLIC_SUPABASE_URL en Render.");
    }

    const cookieStore = cookies();

    // 2. Verificar Usuario (Auth)
    let user = null;
    try {
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
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (authError) {
      console.error("⚠️ Error auth:", authError);
    }

    if (!user) {
      return NextResponse.json({ ok: false, error: "No estás autenticado (401)" }, { status: 401 });
    }

    // 3. Leer Body
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
    }

    // 4. Preparar Datos (Limpieza)
    const name = (body?.name ?? "").toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: "Nombre obligatorio" }, { status: 400 });

    const rawPhone = (body?.phone ?? "").toString().trim();
    const phone = rawPhone ? (rawPhone.startsWith('whatsapp:') ? rawPhone : `whatsapp:+${rawPhone.replace(/\D/g, "")}`) : null;
    
    const vertical = (body?.vertical ?? "general").toString().trim();
    const description = (body?.description ?? "").toString().trim() || null;
    const notification_email = (body?.notification_email ?? "").toString().trim() || null;
    const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

    console.log("📦 Datos listos:", { name, notification_email, has_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY });

    // 5. Cliente Admin
    const sbAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 6. INSERTAR (Aquí es donde da el error de columna si falla)
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
        notification_email, // <--- OJO AQUÍ
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ ERROR SUPABASE:", insErr); // ¡Mira este log en Render!
      return NextResponse.json({ 
        ok: false, 
        error: `Error DB: ${insErr.message} (Detalle: ${insErr.details})` 
      }, { status: 500 });
    }

    // 7. Insertar Owner
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // 8. Cookie
    (await cookies()).set("pyme.active_tenant", tenant.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 CRASH 500:", error);
    // Devolvemos el error real al frontend para que lo veas en el alert
    return NextResponse.json({ 
      ok: false, 
      error: `CRASH: ${error.message}` 
    }, { status: 500 });
  }
}
