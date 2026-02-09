import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WA_BOT_URL = (
  process.env.WA_SERVER_URL || 
  process.env.NEXT_PUBLIC_WA_SERVER_URL || 
  "http://localhost:4001"
).replace(/\/$/, "");

// Función segura para pedir datos al bot sin que explote
async function safeFetch(url: string, options: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
  
  try {
    const res = await fetch(url, { ...options, signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    
    // Si devuelve HTML (error), no lo procesamos como JSON
    const ct = res.headers.get("content-type");
    if (!ct || !ct.includes("application/json")) {
      return { ok: false, error: "Bot devolvió HTML/Error", status: res.status };
    }
    
    const data = await res.json();
    return { ok: true, data, status: res.status };
    
  } catch (e: any) {
    return { ok: false, error: "Bot offline o timeout", status: 0 };
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") || searchParams.get("t");
    
    if (!tenantId) return NextResponse.json({ ok: false, error: "Falta ID" }, { status: 400 });

    const result = await safeFetch(`${WA_BOT_URL}/sessions/${tenantId}`, { method: "GET" });

    // BLINDAJE: Si falló la conexión, decimos "disconnected" en vez de Error 500
    if (!result.ok) {
      console.log(`⚠️ Bot error: ${result.error}`);
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected", error: result.error } 
      });
    }

    const s = result.data.session || result.data || {};
    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: s.status || "disconnected",
        qr_data: s.qr_data || s.qr || null,
        phone: s.phone_number || null
      }
    });

  } catch (error: any) {
    // ESTE CATCH EVITA EL ERROR 500 EN TU PANTALLA
    return NextResponse.json({ ok: false, error: "Error interno API" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, action } = body;
    const tId = tenantId || body.t || body.id;

    if (!tId || !action) return NextResponse.json({ ok: false, error: "Datos faltantes" });

    const endpoint = action === "disconnect"
      ? `${WA_BOT_URL}/sessions/${tId}/disconnect`
      : `${WA_BOT_URL}/sessions/${tId}/connect`;

    const result = await safeFetch(endpoint, { 
      method: "POST", 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!result.ok) {
       return NextResponse.json({ ok: false, error: result.error || "Error al conectar" });
    }

    return NextResponse.json({ ok: true, session: result.data });

  } catch (error: any) {
    return NextResponse.json({ ok: false, error: "Error interno API POST" }, { status: 200 });
  }
}
