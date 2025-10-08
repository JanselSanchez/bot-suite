// src/app/chat/[id]/page.tsx
import "server-only";
import { notFound } from "next/navigation";


// Ajusta esta import según tu proyecto.
// En tus snippets vi: "@/app/lib/superbase" (con 'superbase').
import { supabaseAdmin } from "@/app/lib/superbase";
import MessageList from "./MessageList";
import Composer from "./Composer";

export const dynamic = "force-dynamic";

type PageProps = { params: { id: string } };

export default async function ChatPage({ params }: PageProps) {
  const chatId = params.id;

  // 1) Trae la conversación
  const { data: convo, error: convoErr } = await supabaseAdmin
    .from("conversations")
    .select("id, phone, title")
    .eq("id", chatId)
    .maybeSingle();

  if (convoErr) {
    console.error("conversations error:", convoErr);
    return notFound();
  }
  if (!convo) return notFound();

  // 2) Trae los mensajes (ajusta nombres de columnas si difieren)
  const { data: msgs, error: msgsErr } = await supabaseAdmin
    .from("messages")
    .select("id, conversation_id, role, content, created_at")
    .eq("conversation_id", chatId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (msgsErr) {
    console.error("messages error:", msgsErr);
    return notFound();
  }

  return (
    <div className="flex h-full flex-col">
      <header className="mb-3">
        <h2 className="text-base font-medium">
          {convo.title ?? convo.phone ?? `Chat ${convo.id}`}
        </h2>
        <p className="text-xs text-muted-foreground">
          ID: {convo.id}
        </p>
      </header>

      <div className="flex-1 min-h-0">
        <MessageList initialMessages={msgs ?? []} />
      </div>

      <div className="mt-3">
        <Composer chatId={convo.id} />
      </div>
    </div>
  );
}
