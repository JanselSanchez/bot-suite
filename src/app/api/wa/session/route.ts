// src/app/api/wa/session/route.ts
import { NextResponse } from "next/server";

// 1. URL del Servidor de Bots
const WA_BOT_URL = process.env.NEXT_PUBLIC_WA_SERVER_URL || "http://localhost:4001";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: Obtener estado actual de la sesión
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "Falta tenantId" }, { status: 400 });
    }

    // console.log(`[Proxy] Consultando: ${WA_BOT_URL}/sessions/${tenantId}`);

    const res = await fetch(`${WA_BOT_URL}/sessions/${tenantId}`, {
      cache: "no-store",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      return NextResponse.json({ 
        ok: true, 
        session: { status: "disconnected" } 
      }); 
    }

    const data = await res.json(); 
    // El bot envía: { ok: true, session: { status: '...', qr_data: '...' } }

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

  } catch (error) {
    console.error("[Proxy] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error de conexión" },
      { status: 502 }
    );
  }
}

/**
 * POST: Conectar o Desconectar
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, action } = body; 

    if (!tenantId || !action) {
      return NextResponse.json({ ok: false, error: "Faltan datos" }, { status: 400 });
    }

    const endpoint = action === "disconnect" 
        ? `${WA_BOT_URL}/sessions/${tenantId}/disconnect`
        : `${WA_BOT_URL}/sessions/${tenantId}/connect`;

    console.log(`[Proxy] Acción '${action}' -> ${endpoint}`);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    const data = await res.json();

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
    console.error("[Proxy] Error POST:", error);
    return NextResponse.json(
      { ok: false, error: "Error de comunicación" },
      { status: 500 }
    );
  }
}