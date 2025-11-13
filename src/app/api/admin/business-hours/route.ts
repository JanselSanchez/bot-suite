import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // server only
);

function isUuid(v?: string | null) {
  return !!v && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v);
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");
    if (!isUuid(tenantId)) {
      return NextResponse.json({ error: "tenantId inválido" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("business_hours")
      .select("id, tenant_id, dow, is_closed, open_time, close_time, weekday")
      .eq("tenant_id", tenantId!)
      .order("weekday", { ascending: true });

    if (error) {
      console.error("BH_QUERY_ERROR", error);
      return NextResponse.json({ error: "query_failed" }, { status: 500 });
    }

    return NextResponse.json({ data }, { status: 200 });
  } catch (e: any) {
    console.error("BH_HANDLER_ERROR", e);
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Requeridos
    if (!isUuid(body?.tenant_id)) return NextResponse.json({ error: "tenant_id inválido" }, { status: 400 });
    if (typeof body?.dow !== "number" || body.dow < 0 || body.dow > 6)
      return NextResponse.json({ error: "dow inválido" }, { status: 400 });
    if (typeof body?.is_closed !== "boolean")
      return NextResponse.json({ error: "is_closed inválido" }, { status: 400 });

    const payload = {
      tenant_id: body.tenant_id,
      dow: body.dow,
      is_closed: body.is_closed,
      open_time: body.open_time ?? null,
      close_time: body.close_time ?? null,
      // si no mandan weekday, usamos dow
      weekday: typeof body.weekday === "number" ? body.weekday : body.dow,
    };

    const { data, error } = await sb.from("business_hours").insert(payload).select("*").single();
    if (error) {
      console.error("BH_INSERT_ERROR", error);
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (e: any) {
    console.error("BH_POST_ERROR", e);
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const { id, ...patch } = body || {};
    if (!isUuid(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

    const allowed: any = {};
    if (isUuid(patch.tenant_id)) allowed.tenant_id = patch.tenant_id;
    if (typeof patch.dow === "number" && patch.dow >= 0 && patch.dow <= 6) allowed.dow = patch.dow;
    if (typeof patch.is_closed === "boolean") allowed.is_closed = patch.is_closed;
    if ("open_time" in patch) allowed.open_time = patch.open_time ?? null;
    if ("close_time" in patch) allowed.close_time = patch.close_time ?? null;
    if (typeof patch.weekday === "number") allowed.weekday = patch.weekday;

    const { data, error } = await sb.from("business_hours").update(allowed).eq("id", id).select("*").single();
    if (error) {
      console.error("BH_UPDATE_ERROR", error);
      return NextResponse.json({ error: "update_failed" }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 200 });
  } catch (e: any) {
    console.error("BH_PUT_ERROR", e);
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!isUuid(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

    const { error } = await sb.from("business_hours").delete().eq("id", id!);
    if (error) {
      console.error("BH_DELETE_ERROR", error);
      return NextResponse.json({ error: "delete_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    console.error("BH_DELETE_HANDLER_ERROR", e);
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
}
