// src/app/api/wa/session/route.ts
import { NextResponse } from "next/server";

// 1. URL del Servidor de Bots (Lee la variable de entorno que configuraste en Vercel/Render)
const WA_BOT_URL = process.env.NEXT_PUBLIC_WA_SERVER_URL || "http://localhost:4001";

// Configuraciones para evitar caché en Vercel
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Obtener estado actual de la sesión
 * El Frontend llama aquí -> Este archivo llama a Render -> Render responde
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    console.log(`[Proxy] Consultando estado a: ${WA_BOT_URL}/sessions/${tenantId}`);

    // Llamada al Servidor de Bots (Render)
    const res = await fetch(`${WA_BOT_URL}/sessions/${tenantId}`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      // Si el servidor de bots está apagado o da error
      console.warn("[Proxy] El servidor de bots devolvió error o está offline");
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected" } // Asumimos desconectado si falla
      }); 
    }

    const data = await res.json(); 
    // Data viene del bot así: { ok: true, status: '...', qr: '...', phone: '...' }

    // Transformamos la respuesta para que tu Frontend la entienda (SessionDTO)
    return NextResponse.json({
      ok: true,
      session: {
        id: tenantId,
        status: data.status,
        qr_data: data.qr || null, // Mapeamos 'qr' del bot a 'qr_data' del frontend
        phone_number: data.phone || null,
      },
    });

  } catch (error) {
    console.error("[Proxy] Error de conexión con wa-server:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo conectar con el servidor de WhatsApp" },
      { status: 502 }
    );
  }
}

/**
 * POST: Conectar (Generar QR) o Desconectar
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, action } = body; // action: 'connect' | 'disconnect'

    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: "Faltan datos (tenantId o action)" }, { status: 400 });
    }

    // Definimos a qué endpoint del bot llamar
    const endpoint = action === "disconnect" 
        ? `${WA_BOT_URL}/sessions/${tenantId}/disconnect`
        : `${WA_BOT_URL}/sessions/${tenantId}/connect`;

    console.log(`[Proxy] Enviando acción '${action}' a: ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    // Si el bot responde, devolvemos su respuesta
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data.error || "Error en el servidor de bots" }, { status: 500 });
    }

    // Respuesta exitosa
    return NextResponse.json({
        ok: true,
        session: {
            id: tenantId,
            status: data.status,
            qr_data: data.qr || null,
        }
    });

  } catch (error) {
    console.error("[Proxy] Error crítico enviando acción:", error);
    return NextResponse.json(
      { ok: false, error: "Error de comunicación con el servidor de bots" },
      { status: 500 }
    );
  }
}