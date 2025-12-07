// src/app/api/webhook/messages/send/route.ts
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
// ❌ ELIMINADO: import { enqueueWhatsapp } from "@/server/queue";

export async function GET() {
  return Response.json({ ok: true, route: "/api/webhook/messages/send" });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch (e: any) {
    return Response.json(
      { ok: false, error: "JSON parse failed", detail: e?.message },
      { status: 400 }
    );
  }

  // Extrae campos
  const {
    conversationId,
    text,
    externalId,
    provider,
    meta,
  } = body ?? {};

  const debug = {
    rawBody: body,
    conversationIdType: typeof conversationId,
    textType: typeof text,
    hasExternalId: !!externalId,
    provider: provider ?? null,
  };

  if (
    !conversationId ||
    !text ||
    typeof conversationId !== "string" ||
    typeof text !== "string"
  ) {
    return Response.json(
      {
        ok: false,
        error: "Missing or invalid fields",
        expected: ["conversationId:string", "text:string"],
        debug,
      },
      { status: 400 }
    );
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return Response.json(
      { ok: false, error: "Empty text after trim", debug },
      { status: 400 }
    );
  }

  try {
    // 1) Idempotencia a nivel de mensajes usando externalId
    if (externalId) {
      const { data: existing, error: selErr } = await supabaseAdmin
        .from("messages")
        .select("id")
        .eq("external_id", externalId)
        .maybeSingle();

      if (selErr) {
        console.warn(
          "[messages.select by external_id] warn:",
          selErr?.message || selErr
        );
      }

      if (existing?.id) {
        return Response.json({
          ok: true,
          id: existing.id,
          dedup: true,
          debug,
        });
      }
    }

    // 2) Inserta el mensaje del usuario
    const insertPayload: any = {
      conversation_id: conversationId,
      role: "user",
      content: trimmedText,
    };
    if (externalId) insertPayload.external_id = externalId;

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("messages")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insErr) {
      const msg = (insErr as any)?.message || "";
      const code = (insErr as any)?.code || "";
      const unique =
        code === "23505" ||
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("external_id");

      if (externalId && unique) {
        const { data: existing } = await supabaseAdmin
          .from("messages")
          .select("id")
          .eq("external_id", externalId)
          .maybeSingle();

        if (existing?.id) {
          return Response.json({
            ok: true,
            id: existing.id,
            dedup: true,
            debug,
          });
        }
      }

      return Response.json(
        { ok: false, error: "DB error", detail: insErr },
        { status: 500 }
      );
    }

    // 3) PROCESAMIENTO DIRECTO (Sin Redis)
    // Aquí podrías llamar a tu lógica de IA directamente si fuera necesario.
    // Como eliminamos la cola, solo confirmamos que se guardó.
    
    // Si necesitas que el bot responda a estos mensajes web, 
    // tendrías que invocar la IA aquí mismo o notificar al wa-server.
    // Por ahora, solo guardamos para no romper el flujo.

    return Response.json({ ok: true, id: inserted.id, status: "saved_only_no_queue", debug });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: "Unhandled", detail: e?.message },
      { status: 500 }
    );
  }
}