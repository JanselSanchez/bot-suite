// src/app/api/wa/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ServerStatus = {
  ok: boolean;
  status: "online" | "offline";
  error?: string | null;
  details?: string | null;
};

/**
 * GET /api/wa
 *
 * Devuelve el estado del servidor local de WhatsApp (wa-server.js).
 * NO usa Baileys directo (evita errores de jimp/sharp) y nunca devuelve 400,
 * sólo 200 con status "online" u "offline".
 */
export async function GET() {
  const baseUrl = process.env.WA_SERVER_URL;

  // Si no está configurado, lo tratamos como OFFLINE pero no rompemos el dashboard.
  if (!baseUrl) {
    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_SERVER_URL_NOT_SET",
      details: "Configura WA_SERVER_URL en .env.local (ej: http://localhost:4001)",
    };
    return NextResponse.json(body, { status: 200 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    let resp: Response;

    try {
      resp = await fetch(`${baseUrl}/health`, {
        method: "GET",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Intentamos leer JSON, pero si falla igual devolvemos "offline"
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      // ignore
    }

    const isOk = resp.ok && data && data.ok;
    const body: ServerStatus = {
      ok: isOk,
      status: isOk ? "online" : "offline",
      error: isOk ? null : "WA_SERVER_HEALTH_ERROR",
      details: isOk ? null : `Status HTTP: ${resp.status}`,
    };

    return NextResponse.json(body, { status: 200 });
  } catch (err: any) {
    console.error("[api/wa:GET] error llamando a WA_SERVER_URL/health:", err);

    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_SERVER_UNREACHABLE",
      details: String(err?.message || err),
    };

    return NextResponse.json(body, { status: 200 });
  }
}
