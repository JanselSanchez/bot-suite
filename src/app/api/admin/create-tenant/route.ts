// src/app/api/admin/create-tenant/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // --- PASO 1: LEER EL BODY DE PRIMERO ---
  // Esto es lo más importante para evitar el error "disturbed or locked"
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "Cuerpo de petición inválido" }, { status: 400 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // --- PASO 2: AUTENTICACIÓN (Ahora que el body está seguro en una variable) ---
    const cookieStore = await cookies();
    const supabase = createServerClient(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
      return NextResponse.json({ error: "No autorizado o sesión expirada" }, { status: 401 });
    }

    // --- PASO 3: INSERCIÓN CON SERVICE ROLE (Bypass RLS) ---
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Construimos el payload exacto con las columnas que agregaste en la DB
    const tenantPayload = {
      name: (body.name || "Sin Nombre").trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active",
      vertical: body.vertical || "general",
      description: body.description || "",
      notification_email: body.notification_email || null
    };

    // 1. Crear Negocio
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error en tenants:", insErr.message);
      return NextResponse.json({ error: `Base de datos: ${insErr.message}` }, { status: 500 });
    }

    // 2. Crear relación de dueño
    const { error: memberErr } = await sbAdmin
      .from("tenant_members")
      .insert({ 
        tenant_id: tenant.id, 
        user_id: user.id, 
        role: "owner" 
      });

    if (memberErr) {
      console.error("⚠️ Error en miembros:", memberErr.message);
      // No devolvemos 500 aquí para que el usuario pueda entrar al dashboard
    }

    // 3. Setear cookie de negocio activo
    cookieStore.set("pyme.active_tenant", tenant.id, { 
      path: "/", 
      maxAge: 31536000, 
      sameSite: "lax" 
    });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 Error crítico:", error.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
