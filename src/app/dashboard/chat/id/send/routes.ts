// src/app/api/chat/send/route.ts
import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/app/lib/superbase";
import { chatQueue } from "@/server/queue";

export async function POST(req: NextRequest) {
  try {
    const { conversationId, text } = await req.json();

    if (!conversationId || !text) {
      return new Response("conversationId y text son requeridos", { status: 400 });
    }

    // Inserta el mensaje del usuario
    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: text,
      })
      .select("id")
      .single();

    if (error) {
      console.error(error);
      return new Response("DB error", { status: 500 });
    }
  

    // TODO: aquí puedes:
    // - Encolar a BullMQ para que tu bot responda
    // - Llamar a tu microservicio de WhatsApp/LLM
    // - Insertar el mensaje "assistant" cuando tengas la respuesta

    return Response.json({ ok: true, id: data.id });
  } catch (e: any) {
    console.error(e);
    return new Response(e?.message ?? "Unknown error", { status: 500 });
  }
}
