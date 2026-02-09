import { NextResponse } from "next/server";

// 1. URL del Servidor de Bots
// Si no hay variables de entorno, intenta conectarse a localhost (para desarrollo local)
const WA_BOT_URL = (
  process.env.WA_SERVER_URL || 
  process.env.NEXT_PUBLIC_WA_SERVER_URL || 
  "http://localhost:4001"
).replace(/\/$/, ""); // Quitamos la barra final si existe

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Obtener estado actual de la sesión
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId"); 

    console.log(`🔌 [API WA SESSION] Checkeando: ${tenantId}`);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${tenantId}`;
    
    // Timeout de seguridad (5s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let res;
    try {
      res = await fetch(targetUrl, {
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal
      });
    } catch (fetchError: any) {
        console.warn(`⚠️ [API WA] Bot server offline o timeout: ${fetchError.message}`);
        // Si el bot server no responde, decimos que está desconectado en vez de dar error 500
        return NextResponse.json({ 
            ok: true, 
            session: { status: "disconnected", error: "Bot server unreachable" } 
        });
    } finally {
        clearTimeout(timeoutId);
    }

    // 🛡️ BLINDAJE ANTI-HTML: Verificamos si es JSON real
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        // Si recibimos HTML (ej: error 404 de nginx/cloudflare), no intentamos parsear
        console.error(`🔥 [API WA] Respuesta inválida (No JSON) del bot server.`);
        return NextResponse.json({ 
            ok: true, 
            session: { status: "disconnected", qr_data: null } 
        });
    }

    const data = await res.json();
    
    // Extraemos la sesión soportando diferentes formatos de respuesta
    const botSession = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: botSession.status || "disconnected",
        qr_data: botSession.qr_data || botSession.qr || null, 
        phone_number: botSession.phone_number || null,
      },
    });

  } catch (error: any) {
    console.error("🚨 [API WA CRASH]:", error);
    return NextResponse.json(
      { ok: false, error: "Error interno API: " + error.message },
      { status: 500 }
    );
  }
}

/**
 * POST: Conectar o Desconectar
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tenantId = body.tenantId || body.t || body.id;
    const action = body.action; 

    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 });
    }

    const endpoint = action === "disconnect" 
        ? `${WA_BOT_URL}/sessions/${tenantId}/disconnect`
        : `${WA_BOT_URL}/sessions/${tenantId}/connect`;

    console.log(`🚀 [API WA POST] ${action} -> ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        throw new Error("El bot server devolvió HTML en vez de JSON");
    }
    
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data.error || "Error bot" }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        session: {
            id: tenantId,
            status: data.status || "connecting",
            qr_data: null, 
        }
    });

  } catch (error: any) {
    console.error("🚨 [API WA POST ERROR]:", error);
    return NextResponse.json(
      { ok: false, error: "Error comunicación: " + error.message },
      { status: 500 }
    );
  }
}
