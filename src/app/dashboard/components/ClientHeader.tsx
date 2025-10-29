// src/app/componentes/ClientHeader.tsx
"use client";

import TopTenantSelector from "@/componentes/TopTenantSelector";
import Link from "next/link";

export default function ClientHeader() {
  return (
    <div className="flex items-center gap-3">
      {/* Selector de negocio (verde) */}
      <TopTenantSelector />

      {/* Notificaciones (decorativo) */}
      <button
        type="button"
        aria-label="Notificaciones"
        className="relative grid h-9 w-9 place-items-center rounded-xl border border-gray-200 bg-white shadow-sm hover:bg-gray-50"
      >
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-fuchsia-500" />
        <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-70">
          <path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2Z" fill="currentColor"/>
        </svg>
      </button>

      {/* Usuario opcional */}
      <span className="hidden sm:inline text-sm text-gray-700">janselscruz</span>

      {/* Salir */}
      <Link
        href="/(auth)/signout"
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-gray-50"
      >
        Salir
      </Link>
    </div>
  );
}
