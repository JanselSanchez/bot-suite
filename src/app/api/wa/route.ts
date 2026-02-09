import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Si ves este JSON en el navegador, ESTA ruta es la que está sirviendo.
  return NextResponse.json({
    ok: true,
    hit: "/api/wa (app router)",
    url: req.url,
    ts: Date.now(),
  });
}

export async function POST(req: Request) {
  const bodyText = await req.text().catch(() => "");
  return NextResponse.json({
    ok: true,
    hit: "/api/wa (app router) POST",
    ts: Date.now(),
    bodyPreview: bodyText.slice(0, 200),
  });
}
