// src/app/api/admin/create-tenant/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  // 1) Leer body primero (evita disturbed/locked)
  let body: any;
  try {
    body = await req.json();
  } catch (e: any) {
    console.error("❌ Body inválido", { requestId, msg: e?.message });
    return NextResponse.json(
      { ok: false, error: "Cuerpo de petición inválido", requestId },
      { status: 400 }
    );
  }

  try {
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      console.error("❌ Env faltante", {
        requestId,
        hasUrl: !!supabaseUrl,
        hasAnon: !!anonKey,
        hasService: !!serviceRoleKey,
      });
      return NextResponse.json(
        { ok: false, error: "Faltan variables de entorno de Supabase", requestId },
        { status: 500 }
      );
    }

    // 2) Cookies store (Next 15 puede tiparlo async → await)
    const cookieStore = await cookies();

    // 3) Auth con SSR client (cookie-based) para obtener el user
    const supabaseAuth = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options });
        },
      },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser();

    if (authError || !user) {
      console.error("❌ No autorizado", { requestId, authError });
      return NextResponse.json(
        { ok: false, error: "No autorizado o sesión expirada", requestId },
        { status: 401 }
      );
    }

    // 4) Admin client (service role)
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // 5) Verificar que el user realmente existe en auth.users
    // (evita el 500 por foreign key si por alguna razón el user.id no está en auth.users)
    let userExistsInAuth = false;
    try {
      const { data: authUserRow, error: authUserErr } = await sbAdmin
        .from("auth.users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (authUserErr) {
        console.warn("⚠️ No se pudo validar auth.users (continuamos)", {
          requestId,
          authUserErr,
        });
      } else {
        userExistsInAuth = !!authUserRow?.id;
      }
    } catch (e: any) {
      // En algunos setups, consultar auth.users vía PostgREST puede no estar permitido.
      // No tumbamos el flujo, solo evitamos insertar en tenant_members si no podemos validar.
      console.warn("⚠️ Excepción validando auth.users (continuamos)", {
        requestId,
        msg: e?.message,
      });
    }

    // 6) Payload tenant (incluye owner_id para alinear con tu FK tenants_owner_id_fkey)
    const tenantPayload: any = {
      name: String(body?.name || "Sin Nombre").trim(),
      timezone: body?.timezone || "America/Santo_Domingo",
      phone: body?.phone || null,
      // status en DB tiene default 'active', pero si lo mandamos lo mandamos igual:
      status: "active",
      vertical: body?.vertical || "general",
      description: body?.description || null, // en tu DB description default NULL
      notification_email: body?.notification_email || null,
      owner_id: user.id, // ✅ CLAVE: mantener consistencia con tenants_owner_id_fkey
    };

    console.log("➡️ Create tenant", { requestId, userId: user.id });

    // 7) Insert tenant
    const { data: tenant, error: insErr } = await sbAdmin
      .from("tenants")
      .insert(tenantPayload)
      .select("id")
      .single();

    if (insErr) {
      console.error("❌ Error real en DB (tenants):", { requestId, insErr });
      return NextResponse.json(
        { ok: false, error: `Base de datos (tenants): ${insErr.message}`, requestId },
        { status: 500 }
      );
    }

    // 8) Insert membership (solo si podemos asegurar que no explotará la FK)
    // NOTA: tu tabla tenant_members tiene tenant_id TEXT (no uuid) y FK a tenants(id) (text).
    // Eso está bien, solo mandamos tenant.id como string.
    if (userExistsInAuth) {
      const { error: memberErr } = await sbAdmin.from("tenant_members").insert({
        tenant_id: tenant.id,
        user_id: user.id,
        role: "owner",
      });

      if (memberErr) {
        // No tumbamos el flujo
        console.error("⚠️ Error real en DB (tenant_members):", { requestId, memberErr });
      }
    } else {
      console.warn("⚠️ Saltando tenant_members: user.id no validado en auth.users", {
        requestId,
        userId: user.id,
        tenantId: tenant.id,
      });
    }

    // 9) Set cookie en la RESPUESTA (lo más confiable)
    const res = NextResponse.json({ ok: true, tenantId: tenant.id, requestId });
    res.cookies.set("pyme.active_tenant", tenant.id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      httpOnly: false,
      secure: true,
    });

    return res;
  } catch (error: any) {
    console.error("🔥 Error crítico:", { requestId, error });
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor", requestId },
      { status: 500 }
    );
  }
}
