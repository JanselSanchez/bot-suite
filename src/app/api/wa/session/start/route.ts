// src/app/api/wa/session/start/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantId =
      body?.tenantId ||
      process.env.WA_DEFAULT_TENANT_ID ||
      "creativadominicana";

    const baseUrl = process.env.WA_SERVER_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: "WA_SERVER_URL_NOT_SET" },
        { status: 500 },
      );
    }

    const resp = await fetch(`${baseUrl}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId }),
    });

    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err: any) {
    console.error("[api/wa/session/start] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", details: String(err?.message || err) },
      { status: 500 },
    );
  }
}
