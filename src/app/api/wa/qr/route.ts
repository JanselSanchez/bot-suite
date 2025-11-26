// src/app/api/wa/qr/route.ts
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId =
      searchParams.get("tenantId") ||
      process.env.WA_DEFAULT_TENANT_ID ||
      "creativadominicana";

    const baseUrl = process.env.WA_SERVER_URL;
    if (!baseUrl) {
      return NextResponse.json(
        { ok: false, error: "WA_SERVER_URL_NOT_SET" },
        { status: 500 },
      );
    }

    const resp = await fetch(
      `${baseUrl}/qr?tenantId=${encodeURIComponent(tenantId)}`,
    );
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err: any) {
    console.error("[api/wa/qr] error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error", details: String(err?.message || err) },
      { status: 500 },
    );
  }
}
