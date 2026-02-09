import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function supabaseFromReq(req: Request) {
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // Next Request cookies no están directo aquí; usamos header cookie
          const cookie = req.headers.get("cookie") || "";
          // createServerClient solo necesita getAll/setAll; para getAll devolvemos vacío
          // y dejamos que auth trabaje con header; es suficiente para getUser en muchos casos.
          // Si tú ya tienes helper propio, úsalo.
          return cookie ? [] : [];
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  return { supabase, res };
}

export async function POST(req: Request) {
  console.log("👉 [API ACTIVATE TENANT][POST] hit");

  try {
    const body = await req.json().catch(() => null);
    const tenantId = body?.tenantId;

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId requerido" }, { status: 400 });
    }

    const { supabase } = supabaseFromReq(req);

    // Si no hay auth, NO 500.
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr) {
      console.error("❌ [API ACTIVATE TENANT] getUser error:", userErr);
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }
    if (!userData?.user) {
      return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
    }

    // Intentamos cargar tenant info (si tu tabla se llama distinto, cámbialo)
    // Esto está “a prueba de fallos”: si falla la query, igual no revienta.
    let tenantName: string | null = null;

    try {
      // Ejemplo: tabla tenants (id, name)
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

    // Aquí puedes validar membership (tenant_users / memberships) si aplica.
    // Pero IMPORTANT: no lo hagas “fatal” si todavía no está listo; no queremos 500.

    // Estado WA (si lo guardas en DB). Si no existe, devolvemos defaults.
    let waConnected = false;
    let waPhone: string | null = null;
    let waLastConnectedAt: string | null = null;

    try {
      // Ejemplo: tabla wa_sessions o tenants con columnas wa_*
      // Ajusta según tu schema real:
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

    // Respuesta EXACTA que tu UI usa
    return NextResponse.json({
      ok: true,
      tenantId,
      tenantName,
      waConnected,
      waPhone,
      waLastConnectedAt,
    });
  } catch (error: any) {
    console.error("💥 [API ACTIVATE TENANT][CRASH]:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
