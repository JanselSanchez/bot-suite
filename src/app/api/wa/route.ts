// src/app/api/wa/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ServerStatus = {
  ok: boolean;
  status: "online" | "offline";
  error?: string | null;
  details?: string | null;
};

export async function GET() {
  const baseUrl = process.env.WA_SERVER_URL;

  if (!baseUrl) {
    const body: ServerStatus = {
      ok: false,
      status: "offline",
      error: "WA_SERVER_URL_NOT_SET",
      details: "Configura WA_SERVER_URL en .env.local",
    };
    return NextResponse.json(body, { status: 200 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const resp = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: controller.signal,
    });

    // Limpiamos el timeout en cuanto responde
    clearTimeout(timeout);

    // Intentamos leer JSON de forma segura
    let data: any = null;
    try {
      data = await resp.json();
    } catch {
      // Si no es JSON, data se queda null
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
    // Si entra aquí es porque falló el fetch (timeout o red)
    // Aseguramos limpiar el timeout por si acaso
    clearTimeout(timeout);

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
