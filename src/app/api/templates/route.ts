// src/app/api/message-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tenant = url.searchParams.get("tenant"); // opcional

    // OJO: en Supabase definimos las columnas como:
    // id, tenant_id, channel, event, name, body, active, created_at
    let query = supabaseAdmin
      .from("message_templates")
      .select(
        "id, tenant_id, channel, event, name, body, active, created_at"
      )
      .order("event", { ascending: true });

    if (tenant) {
      query = query.eq("tenant_id", tenant);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[api/message-templates] error:", error);
      return new NextResponse("Error listando plantillas", { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (e: any) {
    console.error("[api/message-templates] unhandled:", e);
    return new NextResponse("Error listando plantillas: " + e.message, {
      status: 500,
    });
  }
}
