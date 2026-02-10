import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1. EXTRAER EL BODY DE INMEDIATO
  // Esto vacía el flujo antes de que Supabase le ponga un candado.
  let body: any;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "Cuerpo de petición inválido" }, { status: 400 });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    // 2. VALIDAR AUTENTICACIÓN (Ahora que el body ya está en la variable 'body')
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    // 3. INSERTAR EN BASE DE DATOS
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false }
    });

    // Solo columnas confirmadas en tu tabla 'tenants'
    const tenantPayload = {
      name: body.name.trim(),
      timezone: body.timezone || "America/Santo_Domingo",
      phone: body.phone || null,
      status: "active"
    };

    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      console.error("Error DB:", insErr.message);
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }

    // Relación de dueño
    await sbAdmin
      .from("tenant_members")
      .insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });

    // Cookie de negocio activo
    cookieStore.set("pyme.active_tenant", tenant.id, { path: "/" });

    return NextResponse.json({ ok: true, tenantId: tenant.id });

  } catch (error: any) {
    console.error("Crash crítico:", error.message);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
