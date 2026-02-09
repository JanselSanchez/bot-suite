import { NextResponse } from "next/server";

// 1. URL del Servidor de Bots
// Si no hay variables de entorno, intenta conectarse a localhost (para desarrollo local)
const WA_BOT_URL = (
  process.env.WA_SERVER_URL || 
  process.env.NEXT_PUBLIC_WA_SERVER_URL || 
  "http://localhost:4001"
).replace(/\/$/, ""); // Quitamos la barra final si existe para evitar //

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Obtener estado actual de la sesión (El Chismoso)
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("t") || searchParams.get("tenantId"); // Aceptamos 't' o 'tenantId'

    // --- 🕵️‍♂️ LOGS PARA DEBUG EN RENDER ---
    console.log(`🔌 [API WA] Conectando a bot en: ${WA_BOT_URL}`);
    console.log(`👤 Tenant ID: ${tenantId}`);

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    const targetUrl = `${WA_BOT_URL}/sessions/${tenantId}`;
    
    // Configurar Timeout de 5 segundos para que no se cuelgue
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
        // Si falla la conexión (el bot server está apagado)
        console.warn(`⚠️ [API WA] No se pudo conectar al bot server: ${fetchError.message}`);
        return NextResponse.json({ 
            ok: true, 
            session: { status: "disconnected", error: "Bot server offline" } 
        });
    } finally {
        clearTimeout(timeoutId);
    }

    // 🚨 PUNTO CRÍTICO: Verificar si la respuesta es JSON antes de parsear
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await res.text();
        console.error(`🔥 [API WA] El bot devolvió algo que NO es JSON: ${textResponse.slice(0, 100)}...`);
        // Asumimos desconectado si el servidor devuelve HTML (ej: 404 Page Not Found)
        return NextResponse.json({ 
            ok: true, 
            session: { status: "disconnected", qr_data: null } 
        });
    }

    // Si llegamos aquí, es seguro parsear
    const data = await res.json();
    
    if (!res.ok) {
      console.warn(`⚠️ [API WA] El bot devolvió error ${res.status}:`, data);
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected" } 
      }); 
    }

    // Extraemos la sesión (soportamos varios formatos de respuesta)
    const botSession = data.session || data || {};

    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: botSession.status || "disconnected",
        // Unificamos qr y qr_data
        qr_data: botSession.qr_data || botSession.qr || null, 
        phone_number: botSession.phone_number || null,
      },
    });

  } catch (error: any) {
    console.error("🚨 [API WA CRASH]:", error);
    // IMPORTANTE: Devolvemos JSON incluso en error crítico para que el frontend no muestre <!DOCTYPE html>
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
    // Aceptamos t, tenantId, id
    const tenantId = body.tenantId || body.t || body.id;
    const action = body.action; 

    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: "Faltan datos (tenantId, action)" }, { status: 400 });
    }

    const endpoint = action === "disconnect" 
        ? `${WA_BOT_URL}/sessions/${tenantId}/disconnect`
        : `${WA_BOT_URL}/sessions/${tenantId}/connect`; // Para connect, a veces es solo crear la sesión

    console.log(`🚀 [API WA POST] Enviando ${action} a: ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body) // Pasamos el body completo por si acaso
    });
    
    // Verificamos JSON igual que en el GET
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
        console.error("🔥 [API WA POST] Respuesta no válida del bot");
        throw new Error("El servidor de bots devolvió una respuesta inválida (HTML/Texto)");
    }
    
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data.error || "Error en el bot" }, { status: 500 });
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
      { ok: false, error: "Error de comunicación: " + error.message },
      { status: 500 }
    );
  }
}
