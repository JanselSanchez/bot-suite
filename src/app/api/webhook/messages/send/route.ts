// src/app/api/webhook/messages/send/route.ts
import { NextRequest } from "next/server";
import { chatQueue } from "@/server/queue";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export async function GET() {
  return Response.json({ ok: true, route: "/api/webhook/messages/send" });
}

export async function POST(req: NextRequest) {
  let body: any = null;
  try {
    body = await req.json();
  } catch (e: any) {
    return Response.json({ ok: false, error: "JSON parse failed", detail: e?.message }, { status: 400 });
  }

  // log de lo que realmente llegó
  const { conversationId, text } = body ?? {};
  const debug = { rawBody: body, conversationIdType: typeof conversationId, textType: typeof text };

  if (!conversationId || !text || typeof conversationId !== "string" || typeof text !== "string") {
    return Response.json(
      { ok: false, error: "Missing or invalid fields", expected: ["conversationId:string", "text:string"], debug },
      { status: 400 }
    );
  }

  try {
    // Inserta el mensaje del usuario
    const { data: inserted, error } = await supabaseAdmin
      .from("messages")
      .insert({ conversation_id: conversationId, role: "user", content: text })
      .select("id")
      .single();

    if (error) {
      return Response.json({ ok: false, error: "DB error", detail: error }, { status: 500 });
    }

    // Encola job
// en tu route.ts al hacer chatQueue.add
await chatQueue.add(
  "user-message",
  { conversationId, userMessageId: inserted.id, text },
  {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 }, // 5s, 10s, 20s...
    removeOnComplete: true,
    removeOnFail: false,
  }
);


    return Response.json({ ok: true, id: inserted.id, debug });
  } catch (e: any) {
    return Response.json({ ok: false, error: "Unhandled", detail: e?.message }, { status: 500 });
  }
}
