"use client";

import TopTenantSelector from "@/componentes/TopTenantSelector";
import Link from "next/link";

export default function HeaderBar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/60 bg-white/70 backdrop-blur-xl shadow-sm">
      <div className="mx-auto max-w-7xl flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo + Marca */}
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white font-semibold text-sm shadow">
            PB
          </div>
          <span className="font-semibold text-slate-800 tracking-tight">PymeBOT</span>
        </div>

        {/* Selector de Tenant + Salir */}
        <div className="flex items-center gap-4">
          <TopTenantSelector />
          {/* Usa <Link> en vez de onClick para evitar handlers en el layout */}
          <Link
            href="/signout" // si tu ruta es diferente, cámbiala (p.ej. "/auth/signout")
            className="rounded-2xl border px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition"
          >
            Salir
          </Link>
        </div>
      </div>
    </header>
  );
}
