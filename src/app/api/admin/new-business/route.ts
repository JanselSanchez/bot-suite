// src/app/api/admin/new-business/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  console.log("🚀 Iniciando creación de negocio..."); // Log para ver si arranca

  try {
    const cookieStore = cookies();

    // 1. Cliente para verificar al usuario (Auth)
    // Usamos try/catch aquí por si falla la cookie
    let user = null;
    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            async get(name: string) {
              return (await cookieStore).get(name)?.value;
            },
            async set(name: string, value: string, options: any) {
              try { (await cookieStore).set({ name, value, ...options }); } catch {}
            },
            async remove(name: string, options: any) {
              try { (await cookieStore).set({ name, value: "", ...options }); } catch {}
            },
          },
        }
      );
      const { data } = await supabase.auth.getUser();
      user = data.user;
    } catch (authError) {
      console.error("⚠️ Error verificando sesión:", authError);
    }

    // Validación de seguridad
    if (!user) {
      console.log("❌ Usuario no autenticado.");
      return NextResponse.json({ ok: false, error: "Sesión expirada (401)" }, { status: 401 });
    }

    // 2. Leer y limpiar el Body
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      return NextResponse.json({ ok: false, error: "Datos corruptos (JSON inválido)" }, { status: 400 });
    }

    const name = (body?.name ?? "").toString().trim();
    
    // Limpieza agresiva: Si es string vacío, lo volvemos NULL
    const rawPhone = (body?.phone ?? "").toString().trim();
    // Formato WhatsApp: whatsapp:+1809...
    const phone = rawPhone ? (rawPhone.startsWith('whatsapp:') ? rawPhone : `whatsapp:+${rawPhone.replace(/\D/g, "")}`) : null;
    
    const vertical = (body?.vertical ?? "general").toString().trim();
    
    const rawDesc = (body?.description ?? "").toString().trim();
    const description = rawDesc === "" ? null : rawDesc;

    const rawEmail = (body?.notification_email ?? "").toString().trim();
    const notification_email = rawEmail === "" ? null : rawEmail;

    const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

    if (!name) {
      return NextResponse.json({ ok: false, error: "El nombre es obligatorio" }, { status: 400 });
    }

    console.log("📦 Payload a insertar:", { name, vertical, email: notification_email, phone_len: phone?.length });

    // 3. Cliente Admin (Service Role) para escribir en la DB
    const sbAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    // 4. Insertar Tenant
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
        notification_email, // IMPORTANTE: Asegúrate de que esta columna exista en Supabase -> 'tenants'
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error Supabase INSERT:", insErr);
      return NextResponse.json({ 
        ok: false, 
        error: `Error Base de Datos: ${insErr.message} (Code: ${insErr.code})` 
      }, { status: 500 });
    }

    console.log("✅ Tenant creado:", tenant.id);

    // 5. Crear relación Owner
    const { error: memberErr } = await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    if (memberErr) {
      console.error("⚠️ Error en tenant_members (No crítico):", memberErr);
    }

    // 6. Setear Cookie del negocio activo
    (await cookies()).set("pyme.active_tenant", tenant.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (globalError: any) {
    console.error("🔥 CRASH FATAL EN API:", globalError);
    return NextResponse.json({ 
      ok: false, 
      error: `Error Interno del Servidor: ${globalError.message}` 
    }, { status: 500 });
  }
}
