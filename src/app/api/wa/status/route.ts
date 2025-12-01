// src/app/api/wa/status/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Healthcheck muy simple del servidor de WhatsApp.
 *
 * NOTA:
 * - Ya no usamos el runtime viejo de Baileys aquí.
 * - Solo comprobamos que la API responde; la lógica real de sesiones
 *   y QR la maneja /api/wa/session + baileysManager.
 */
export async function GET() {
  try {
    return NextResponse.json(
      {
        ok: true,
        online: true,
        status: "online",
        ts: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[api/wa/status] internal_error:", err);
    return NextResponse.json(
      {
        ok: false,
        online: false,
        status: "offline",
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}
