import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get("tenantId")!;
  const resourceId = searchParams.get("resourceId");
  const from = searchParams.get("from"); // ISO opcional
  const to = searchParams.get("to");     // ISO opcional

  let q = sb.from("exceptions").select("*").eq("tenant_id", tenantId).order("starts_at");
  q = resourceId ? q.eq("resource_id", resourceId) : q;
  q = from ? q.gte("starts_at", from) : q;
  q = to ? q.lte("ends_at", to) : q;

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function POST(req: Request) {
  const body = await req.json();
  const { data, error } = await sb.from("exceptions").insert(body).select("*");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const { id, ...patch } = body;
  const { data, error } = await sb.from("exceptions").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")!;
  const { error } = await sb.from("exceptions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
