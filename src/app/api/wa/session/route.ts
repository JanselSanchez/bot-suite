import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1. Configuración de la URL del Bot
// Si no existe la variable en Render, asumimos localhost (esto evita crashes por undefined)
const WA_BOT_URL = (
  process.env.WA_SERVER_URL || 
  process.env.NEXT_PUBLIC_WA_SERVER_URL || 
  "http://localhost:4001"
).replace(/\/$/, ""); // Quitamos barra final si existe

export async function GET(req: Request) {
  // 🕵️ LOG PARA RENDER: Queremos ver si la petición llega
  console.log("👉 [API SESSION] Iniciando petición...");

  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId");

    console.log(`👤 Tenant ID: ${tenantId}`);
    console.log(`🤖 Bot URL: ${WA_BOT_URL}`);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    // 2. Intentamos conectar al servidor de bots
    const targetUrl = `${WA_BOT_URL}/sessions/${tenantId}`;
    
    // Timeout de 4 segundos (para que no se quede colgado eternamente)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    let res;
    try {
      res = await fetch(targetUrl, {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        cache: "no-store"
      });
    } catch (fetchError: any) {
      console.error(`❌ [API SESSION] No se pudo conectar al Bot Server: ${fetchError.message}`);
      // EN VEZ DE ERROR 500, devolvemos JSON diciendo que está desconectado
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected", error: "Bot server unreachable" } 
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // 3. BLINDAJE: Verificamos si la respuesta es JSON real
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text = await res.text();
      console.error(`🔥 [API SESSION] El bot devolvió HTML/Texto en vez de JSON: ${text.slice(0, 100)}`);
      // Si el bot devuelve error HTML, asumimos desconectado
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected", error: "Bot server error" } 
      });
    }

    // 4. Si es JSON seguro, lo leemos
    const data = await res.json();
    
    // Manejo flexible de la estructura de respuesta
    const sessionData = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: sessionData.status || "disconnected",
        qr_data: sessionData.qr_data || sessionData.qr || null,
        phone: sessionData.phone_number || null
      }
    });

  } catch (error: any) {
    console.error("💥 [API SESSION CRASH]:", error);
    // IMPORTANTE: Devolvemos JSON incluso en el peor error
    return NextResponse.json({ 
      ok: false, 
      error: "Error interno: " + error.message 
    }, { status: 500 });
  }
}

// POST: Para conectar/desconectar
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, tenantId } = body;
    const tId = tenantId || body.t || body.id;

    if (!tId || !action) return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });

    const endpoint = action === "disconnect" 
      ? `${WA_BOT_URL}/sessions/${tId}/disconnect`
      : `${WA_BOT_URL}/sessions/${tId}/connect`;

    console.log(`🚀 [API POST] Enviando ${action} a ${endpoint}`);

    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });

    // Mismo blindaje que el GET
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        console.error("🔥 [API POST] Respuesta no JSON del bot server");
        throw new Error("Respuesta inválida del servidor de bots");
    }

    const data = await res.json();
    return NextResponse.json({ ok: true, session: data });

  } catch (error: any) {
    console.error("💥 [API POST CRASH]:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
