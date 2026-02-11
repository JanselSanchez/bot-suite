// src/app/api/admin/create-tenant/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // 1) Leer body primero (evita disturbed/locked)
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo de petición inválido" },
      { status: 400 }
    );
  }

  try {
    // 2) Env vars (TRIM para Render)
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("❌ Env faltante", {
        hasUrl: !!supabaseUrl,
        hasAnon: !!anonKey,
        hasService: !!serviceRoleKey,
      });
      return NextResponse.json(
        { ok: false, error: "Faltan variables de entorno de Supabase" },
        { status: 500 }
      );
    }

    // 3) Auth (cookie-based) — leer cookies sin tocar body
    // Next 15: cookies() puede ser async en algunos targets -> usar await.
    const cookieStore = await cookies();

    const supabaseAuth = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // No necesitamos setAll para solo validar sesión.
        setAll() {},
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "No autorizado o sesión expirada" },
        { status: 401 }
      );
    }

    // 4) Admin client (service role)
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const tenantPayload = {
      name: String(body?.name || "Sin Nombre").trim(),
      timezone: body?.timezone || "America/Santo_Domingo",
      phone: body?.phone || null,
      status: "active",
      vertical: body?.vertical || "general",
      description: body?.description || "",
      notification_email: body?.notification_email || null,
    };

    // 5) Insert tenant
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error real en DB (tenants):", insErr);
      return NextResponse.json(
        { ok: false, error: `Base de datos: ${insErr.message}` },
        { status: 500 }
      );
    }

    // 6) Insert membership (no tumbar flujo si falla)
    const { error: memberErr } = await sbAdmin.from("tenant_members").insert({
      tenant_id: tenant.id,
      user_id: user.id,
      role: "owner",
    });

    if (memberErr) {
      console.error("⚠️ Error real en DB (tenant_members):", memberErr);
    }

    // 7) Set cookie correctamente EN LA RESPUESTA
    const res = NextResponse.json({ ok: true, tenantId: tenant.id });
    res.cookies.set("pyme.active_tenant", tenant.id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });

    return res;
  } catch (error: any) {
    console.error("🔥 Error crítico:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
