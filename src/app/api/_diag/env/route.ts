import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const hasUrl = !!(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const hasAnon = !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  const hasService = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  // No exponemos la key, solo confirmamos presencia y longitud
  const serviceLen = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim().length;

  return NextResponse.json({
    ok: true,
    where: "next-web",
    hasUrl,
    hasAnon,
    hasService,
    serviceLen,
    renderCommit: process.env.RENDER_GIT_COMMIT || null,
    nodeEnv: process.env.NODE_ENV || null,
  });
}
