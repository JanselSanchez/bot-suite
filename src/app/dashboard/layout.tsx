// src/app/chat/[id]/layout.tsx
import { Separator } from "@radix-ui/react-separator";
import type { ReactNode } from "react";


export default function ChatLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Chat</h1>
        </div>
        <Separator />
      </div>
      <div className="mx-auto max-w-5xl px-4 py-4 h-[calc(100vh-64px)]">
        {children}
      </div>
    </div>
  );
}
