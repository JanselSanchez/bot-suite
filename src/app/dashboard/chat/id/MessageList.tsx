// src/app/chat/[id]/MessageList.tsx
"use client";

import { cn } from "@/app/lib/utils";
import { useEffect, useRef } from "react";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
};

export default function MessageList({ initialMessages }: { initialMessages: Msg[] }) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [initialMessages]);

  return (
    <div className="h-full overflow-y-auto rounded-xl border p-3 space-y-3">
      {initialMessages.length === 0 && (
        <div className="text-sm text-muted-foreground">No hay mensajes aún.</div>
      )}

      {initialMessages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm",
            m.role === "user"
              ? "ml-auto bg-primary text-primary-foreground"
              : "mr-auto bg-muted"
          )}
          title={new Date(m.created_at).toLocaleString()}
        >
          {m.content}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
