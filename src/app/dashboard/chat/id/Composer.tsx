// src/app/chat/[id]/Composer.tsx
"use client";

import { Button } from "@/componentes/ui/button";
import { Textarea } from "@/componentes/ui/textarea";
import { useState } from "react";


export default function Composer({ chatId }: { chatId: string }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function send() {
    const payload = { conversationId: chatId, text };
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || "Error enviando mensaje");
      }
      setText("");
      // Sugerencia: usa SWR/React Query o un canal realtime para refrescar.
      // Por ahora, forzamos un refresh de la ruta:
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("No se pudo enviar el mensaje.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribe un mensaje…"
        className="min-h-[44px] max-h-48"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <Button onClick={send} disabled={loading || !text.trim()}>
        {loading ? "Enviando…" : "Enviar"}
      </Button>
    </div>
  );
}
