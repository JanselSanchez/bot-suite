// src/app/api/webhook/messages/send/route.ts
import { NextRequest } from "next/server";
import crypto from "crypto";

import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { enqueueWhatsapp } from "@/server/queue";

export async function GET() {
  return Response.json({ ok: true, route: "/api/webhook/messages/send" });
}

/**
 * Genera un jobId determinista para BullMQ cuando NO tenemos externalId del proveedor.
 * Usa bucket de 1 minuto para absorber dobles submits/reintentos muy cercanos.
 */
function fallbackJobId(conversationId: string, text: string) {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = crypto
    .createHash("sha256")
    .update(`${conversationId}|${text.trim()}|${minuteBucket}`)
    .digest("hex");
  return `inbound:${conversationId}:${key}`;
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

  // Extrae campos (admite opcional externalId/metadata del proveedor)
  const {
    conversationId,
    text,
    externalId, // p.ej. Twilio MessageSid
    provider, // opcional, "twilio" | "whatsapp" | ...
    meta, // opcional: cualquier metadata del proveedor
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
    // 1) Idempotencia a nivel de mensajes usando externalId (si está disponible)
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
        // Ya procesado: NO encolar de nuevo
        return Response.json({
          ok: true,
          id: existing.id,
          dedup: true,
          debug,
        });
      }
    }

    // 2) Inserta el mensaje del usuario (con external_id si viene)
    const insertPayload: any = {
      conversation_id: conversationId,
      role: "user",
      content: trimmedText,
    };
    if (externalId) insertPayload.external_id = externalId;
    if (provider || meta) {
      // Si luego agregas columnas para metadata, puedes guardarlas aquí:
      // insertPayload.provider = provider ?? null;
      // insertPayload.meta = meta ?? null; // requiere columna jsonb opcional
    }

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("messages")
      .insert(insertPayload)
      .select("id")
      .single();

    if (insErr) {
      // Si rompe por unique constraint en external_id, recupera y sal con dedup
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

    // 3) Encola job con jobId idempotente:
    //    - Si hay externalId (p.ej. Twilio MessageSid) úsalo como jobId
    //    - Si no hay, usa hash determinista por minuto
    const jobId = externalId
      ? `inbound:${provider || "ext"}:${externalId}`
      : fallbackJobId(conversationId, trimmedText);

    await enqueueWhatsapp(
      "user-message",
      {
        conversationId,
        userMessageId: inserted.id,
        text: trimmedText,
        externalId: externalId ?? null,
        provider: provider ?? null,
      },
      {
        jobId, // 👈 evita duplicados en cola
        attempts: 1, // 👈 no reintentar mensajes del usuario (evita dobles respuestas)
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    return Response.json({ ok: true, id: inserted.id, jobId, debug });
  } catch (e: any) {
    return Response.json(
      { ok: false, error: "Unhandled", detail: e?.message },
      { status: 500 }
    );
  }
}
