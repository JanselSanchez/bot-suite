// src/app/api/wa/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const baseUrl = process.env.WA_SERVER_URL;

    // Si no hay URL configurada, consideramos el servidor WA como offline
    if (!baseUrl) {
      console.error("[api/wa] WA_SERVER_URL not set");
      return NextResponse.json(
        {
          ok: false,
          status: "offline",
          error: "WA_SERVER_URL_NOT_SET",
        },
        { status: 500 },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let resp: Response;

    try {
      // Ping al servidor de WA.
      // Aunque devuelva 404, si responde algo lo consideramos "online".
      resp = await fetch(`${baseUrl}/status`, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      console.error("[api/wa] fetch error:", err);
      const isAbortError = err?.name === "AbortError";

      return NextResponse.json(
        {
          ok: false,
          status: "offline",
          error: isAbortError ? "wa_server_timeout" : "wa_server_unreachable",
          details: String(err?.message || err),
        },
        { status: 502 },
      );
    } finally {
      clearTimeout(timeout);
    }

    const raw = await resp.text();
    let parsed: any = null;

    // Intentamos parsear como JSON, pero no es obligatorio
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    // Consideramos ONLINE si el servidor respondió algo (aunque sea 404 / HTML)
    return NextResponse.json(
      {
        ok: true,
        status: "online",
        upstream: {
          httpStatus: resp.status,
          raw,        // respuesta tal cual (por ejemplo "Cannot GET /status")
          json: parsed, // si era JSON válido, viene aquí; si no, null
        },
      },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[api/wa] internal_error:", err);
    return NextResponse.json(
      {
        ok: false,
        status: "offline",
        error: "internal_error",
        details: String(err?.message || err),
      },
      { status: 500 },
    );
  }
}
