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
    // 1. Verificación de variables de entorno
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!serviceRoleKey || !supabaseUrl || !anonKey) {
      console.error("❌ Faltan variables de entorno críticas");
      return NextResponse.json({ 
        ok: false, 
        error: "Configuración del servidor incompleta (Variables de entorno)." 
      }, { status: 500 });
    }

    // 2. Auth Check con cliente de servidor
    const cookieStore = await cookies();
    const supabase = createServerClient(
      supabaseUrl,
      anonKey,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set(name: string, value: string, options: any) { cookieStore.set({ name, value, ...options }); },
          remove(name: string, options: any) { cookieStore.set({ name, value: "", ...options }); },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ ok: false, error: "Sesión expirada o inválida" }, { status: 401 });
    }

    // 3. Leer y Validar Body
    let body: any = {};
    try { 
      body = await req.json(); 
    } catch { 
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); 
    }

    const name = (body?.name ?? "").toString().trim();
    if (!name) return NextResponse.json({ ok: false, error: "El nombre es obligatorio" }, { status: 400 });

    // 4. Preparar datos para la tabla 'tenants' 
    // NOTA: Solo incluimos columnas que existen en tu imagen de DB
    const rawPhone = (body?.phone ?? "").toString().trim();
    let phone = null;
    if (rawPhone) {
      // Si ya viene con el prefijo 'whatsapp:', lo dejamos, si no, lo construimos
      phone = rawPhone.startsWith('whatsapp:') ? rawPhone : `whatsapp:${rawPhone.startsWith('+') ? '' : '+'}${rawPhone.replace(/\D/g, "")}`;
    }

    const timezone = (body?.timezone ?? "America/Santo_Domingo").toString();

    // 5. Crear cliente Admin (Bypass RLS)
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    console.log("💾 Insertando en tabla tenants...");

    // Insertamos solo las columnas confirmadas en tu captura de pantalla
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert({
        name,
        timezone,
        phone,
        status: "active"
        // ⚠️ Eliminamos vertical, description y notification_email porque fallan si no están en la tabla
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error al insertar tenant:", insErr);
      return NextResponse.json({ 
        ok: false, 
        error: `Error DB: ${insErr.message}. Verifica que las columnas existan en la tabla tenants.` 
      }, { status: 500 });
    }

    // 6. Crear relación en tenant_members
    const { error: memberErr } = await sbAdmin
      .from("tenant_members")
      .insert({ 
        tenant_id: tenant.id, 
        user_id: user.id, 
        role: "owner" 
      });

    if (memberErr) {
      console.error("⚠️ Error al crear miembro:", memberErr);
      // No frenamos el proceso, pero lo logueamos
    }

    // 7. Si quieres guardar vertical/descripción, asumo que van en business_profiles
    // Si la tabla business_profiles existe, lo insertamos ahí:
    const vertical = (body?.vertical ?? "general").toString().trim();
    const description = (body?.description ?? "").toString().trim();
    
    if (vertical || description) {
      await sbAdmin
        .from("business_profiles")
        .insert({
          tenant_id: tenant.id,
          vertical: vertical,
          description: description
        }).maybeSingle(); 
    }

    // 8. Establecer Cookie de Tenant Activo
    cookieStore.set("pyme.active_tenant", tenant.id, {
      path: "/",
      httpOnly: false,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });

    console.log("✅ Negocio creado con éxito:", tenant.id);
    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 CRASH API:", error);
    return NextResponse.json({ 
      ok: false, 
      error: `Error Interno: ${error.message}` 
    }, { status: 500 });
  }
}
