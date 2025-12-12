import { NextResponse } from "next/server";

// 1. URL del Servidor de Bots (El Proxy usará esto)
// CORRECCIÓN: Ahora busca 'WA_SERVER_URL' (privada) O 'NEXT_PUBLIC_WA_SERVER_URL' (pública) O usa localhost.
const WA_BOT_URL = process.env.WA_SERVER_URL || process.env.NEXT_PUBLIC_WA_SERVER_URL || "http://localhost:4001";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Obtener estado actual de la sesión (El Chismoso)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    // --- 🕵️‍♂️ ZONA DE CHISMORREO (DEBUG) 🕵️‍♂️ ---
    console.log("\n========================================");
    console.log("🕵️ [PROXY GET] Solicitud recibida");
    console.log(`👤 Tenant ID: ${tenantId}`);
    console.log(`🌍 Env Privada (WA_SERVER_URL): '${process.env.WA_SERVER_URL}'`);
    console.log(`🌍 Env Pública (NEXT_PUBLIC_WA_SERVER_URL): '${process.env.NEXT_PUBLIC_WA_SERVER_URL}'`);
    console.log(`🎯 URL Final que usaremos: '${WA_BOT_URL}'`);
    // ---------------------------------------------

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${tenantId}`;
    console.log(`🚀 [PROXY GET] Fetching a: ${targetUrl}`);

    const res = await fetch(targetUrl, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" }
    });

    console.log(`📡 [PROXY GET] Status del wa-server: ${res.status}`);

    if (!res.ok) {
      console.warn(`⚠️ [PROXY GET] El wa-server devolvió error o 404. Asumiendo desconectado.`);
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected" } 
      }); 
    }

    const data = await res.json(); 
    
    // --- 🕵️‍♂️ CHISMORREO DE DATOS ---
    console.log("📦 [PROXY GET] Data cruda recibida:", JSON.stringify(data, null, 2));
    // -------------------------------

    // 🔥 CORRECCIÓN: Accedemos a data.session, no a data directo
    const botSession = data.session || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: botSession.status || "disconnected",
        // Aquí estaba el error: el bot manda 'qr_data', no 'qr'
        qr_data: botSession.qr_data || botSession.qr || null, 
        phone_number: botSession.phone_number || null,
      },
    });

  } catch (error: any) {
    console.error("🚨 [PROXY ERROR] Excepción:", error);
    return NextResponse.json(
      { ok: false, error: "Error de conexión: " + error.message },
      { status: 502 }
    );
  }
}

/**
 * POST: Conectar o Desconectar (El Chismoso)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, action } = body; 

    // --- 🕵️‍♂️ ZONA DE CHISMORREO (DEBUG) 🕵️‍♂️ ---
    console.log("\n========================================");
    console.log(`🕵️ [PROXY POST] Acción solicitada: ${action}`);
    console.log(`👤 Tenant ID: ${tenantId}`);
    // ---------------------------------------------

    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 });
    }

    const endpoint = action === "disconnect" 
        ? `${WA_BOT_URL}/sessions/${tenantId}/disconnect`
        : `${WA_BOT_URL}/sessions/${tenantId}/connect`;

    console.log(`🚀 [PROXY POST] Fetching a: ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    const data = await res.json();
    console.log(`📡 [PROXY POST] Respuesta del wa-server:`, data);

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data.error || "Error bot" }, { status: 500 });
    }

    // El POST de connect a veces devuelve { status: 'connecting' } directo
    return NextResponse.json({
        ok: true,
        session: {
            id: tenantId,
            status: data.status || "connecting",
            qr_data: null, // El QR se obtiene por el GET (polling)
        }
    });

  } catch (error) {
    console.error("🚨 [PROXY POST ERROR]:", error);
    return NextResponse.json(
      { ok: false, error: "Error de comunicación" },
      { status: 500 }
    );
  }
}