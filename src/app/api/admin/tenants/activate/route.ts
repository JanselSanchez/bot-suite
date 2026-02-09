// src/app/api/admin/tenants/activate/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function createSupabase(req: NextRequest) {
  // Creamos una respuesta "vacía" que devolveremos al final para poder setear cookies.
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll(); // ✅ AQUÍ estaba el bug
        },
        setAll(cookiesToSet) {
          // ✅ Setear cookies en la RESPUESTA
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  return { supabase, res };
}

export async function POST(req: NextRequest) {
  console.log("👉 [API ACTIVATE TENANT][POST] hit");

  try {
    const body = await req.json().catch(() => null);
    const tenantId = body?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    const { supabase, res } = createSupabase(req);

    // ✅ Auth real (con cookies)
    const { data: userData, error: userErr } = await supabase.auth.getUser();

    if (userErr) {
      console.error("❌ [API ACTIVATE TENANT] getUser error:", userErr);
      // devolvemos 401, sin 500
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    if (!userData?.user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    // ---- Tenant info (opcional, no fatal) ----
    let tenantName: string | null = null;

    try {
      const { data: tenantRow, error: tenantErr } = await supabase
        .from("tenants")
        .select("id,name")
        .eq("id", tenantId)
        .maybeSingle();

      if (tenantErr) {
        console.warn("⚠️ [API ACTIVATE TENANT] tenants lookup warn:", tenantErr);
      } else {
        tenantName = tenantRow?.name ?? null;
      }
    } catch (e) {
      console.warn("⚠️ [API ACTIVATE TENANT] tenants lookup crash:", e);
    }

    // ---- WA state (opcional, no fatal) ----
    let waConnected = false;
    let waPhone: string | null = null;
    let waLastConnectedAt: string | null = null;

    try {
      const { data: waRow, error: waErr } = await supabase
        .from("wa_sessions")
        .select("tenant_id, connected, phone_number, last_connected_at")
        .eq("tenant_id", tenantId)
        .maybeSingle();

      if (waErr) {
        console.warn("⚠️ [API ACTIVATE TENANT] wa_sessions warn:", waErr);
      } else if (waRow) {
        waConnected = !!waRow.connected;
        waPhone = waRow.phone_number ?? null;
        waLastConnectedAt = waRow.last_connected_at ?? null;
      }
    } catch (e) {
      console.warn("⚠️ [API ACTIVATE TENANT] wa_sessions crash:", e);
    }

    // ✅ Importante: devolver la respuesta FINAL usando res.headers/cookies si setAll fue usado
    // Como estamos retornando JSON, copiamos las cookies de `res` a esta respuesta:
    const jsonRes = NextResponse.json(
      {
        ok: true,
        tenantId,
        tenantName,
        waConnected,
        waPhone,
        waLastConnectedAt,
      },
      { status: 200 }
    );

    // Copiar cookies seteadas por supabase al JSON response
    res.cookies.getAll().forEach((c) => {
      jsonRes.cookies.set(c);
    });

    return jsonRes;
  } catch (error: any) {
    console.error("💥 [API ACTIVATE TENANT][CRASH]:", error);
    return NextResponse.json({ ok: false, error: error?.message || String(error) }, { status: 500 });
  }
}
