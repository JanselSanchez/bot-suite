// src/app/api/admin/metrics/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeJsonParse(raw: string) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();

  // ✅ 1) Leer body UNA sola vez de forma segura (Next 15 friendly)
  const raw = await req.text(); // <- NO req.json()
  const body = safeJsonParse(raw);

  if (body === null) {
    console.error("❌ metrics body inválido", { requestId, rawPreview: raw?.slice(0, 120) });
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
      console.error("❌ metrics env faltante", {
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

    // ✅ 2) Auth por cookies (NO toca body)
    const cookieStore = await cookies();
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

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { ok: false, error: "No autorizado o sesión expirada", requestId },
        { status: 401 }
      );
    }

    // ✅ 3) Admin client
    const sbAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ✅ 4) Lee tenantId de cookie o del body (lo que tú uses)
    const tenantId =
      (cookieStore.get("pyme.active_tenant")?.value || "").trim() ||
      String((body as any)?.tenantId || "").trim();

    if (!tenantId) {
      return NextResponse.json(
        { ok: false, error: "tenantId requerido", requestId },
        { status: 400 }
      );
    }

    // ✅ 5) Aquí va tu lógica REAL de métricas
    // Dejo un ejemplo “safe”, tú ajustas según tu tabla/consulta:
    // - Si tus métricas vienen de messages, sessions, etc, haz select/aggregate aquí.

    // EJEMPLO: validar que el tenant exista
    const { data: tenant, error: tenErr } = await sbAdmin
      .from("tenants")
      .select("id")
      .eq("id", tenantId)
      .maybeSingle();

    if (tenErr) {
      console.error("❌ metrics tenants lookup", { requestId, tenErr });
      return NextResponse.json(
        { ok: false, error: tenErr.message, requestId },
        { status: 500 }
      );
    }

    if (!tenant?.id) {
      return NextResponse.json(
        { ok: false, error: "Tenant no existe", requestId },
        { status: 404 }
      );
    }

    // ✅ RESPUESTA OK (ajústala a tu payload real)
    return NextResponse.json({
      ok: true,
      requestId,
      tenantId,
      metrics: {
        // placeholder: aquí pon tus contadores reales
        messagesLast24h: 0,
        sessionsActive: 0,
      },
    });
  } catch (e: any) {
    console.error("🔥 metrics crash", { requestId, msg: e?.message, stack: e?.stack });
    return NextResponse.json(
      { ok: false, error: "Error interno del servidor", requestId },
      { status: 500 }
    );
  }
}
