import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  /**
   * PASO 1: LEER EL BODY DE INMEDIATO
   * Es vital que esta sea la PRIMERA acción para que el stream de datos
   * no sea bloqueado por el middleware o el cliente de autenticación.
   */
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "Cuerpo de petición inválido o vacío" }, { status: 400 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    /**
     * PASO 2: VALIDAR AUTENTICACIÓN
     * Ahora que ya tenemos los datos en la variable 'body', podemos inicializar
     * Supabase sin miedo a que bloquee la petición original.
     */
    const cookieStore = await cookies();
    const supabase = createServerClient(
      supabaseUrl,
      supabaseAnonKey,
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
      return NextResponse.json({ error: "Sesión no válida o expirada" }, { status: 401 });
    }

    /**
     * PASO 3: INSERTAR EN BASE DE DATOS
     * Usamos sbAdmin (Service Role) para asegurar permisos de escritura totales.
     */
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Preparamos el objeto con todas las columnas (incluyendo las nuevas que creaste)
    const tenantPayload = {
      name: body.name.trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active",
      vertical: body.vertical || "general",
      description: body.description || "",
      notification_email: body.notification_email || null
    };

    // 1. Crear el negocio en la tabla 'tenants'
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error Supabase (tenants):", insErr.message);
      return NextResponse.json({ error: `Error DB: ${insErr.message}` }, { status: 500 });
    }

    // 2. Crear la relación de membresía como 'owner'
    const { error: memberErr } = await sbAdmin
      .from("tenant_members")
      .insert({ 
        tenant_id: tenant.id, 
        user_id: user.id, 
        role: "owner" 
      });

    if (memberErr) {
      console.error("⚠️ Error al crear miembro (no crítico):", memberErr.message);
    }

    /**
     * PASO 4: FINALIZAR
     * Establecemos la cookie del negocio activo y retornamos éxito.
     */
    cookieStore.set("pyme.active_tenant", tenant.id, { 
      path: "/",
      maxAge: 31536000, // 1 año
      sameSite: "lax"
    });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("🔥 Crash crítico en el servidor:", error.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
