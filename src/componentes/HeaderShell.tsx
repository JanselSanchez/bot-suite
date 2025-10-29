// src/app/componentes/HeaderShell.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, RefreshCcw, Bell } from "lucide-react";
import TopTenantSelector from "@//componentes/TopTenantSelector";

function Pill({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  const pathname = usePathname();
  const active = pathname?.startsWith(href);
  return (
    <Link
      href={href}
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm border shadow-sm transition",
        active
          ? "bg-violet-600 text-white border-violet-600"
          : "bg-white/90 text-gray-800 border-white/60 hover:bg-white",
      ].join(" ")}
    >
      {icon}
      {label}
    </Link>
  );
}

export default function HeaderShell() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        {/* Izquierda: Logo + marca */}
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-xs font-semibold shadow">
            PB
          </div>
          <span className="font-semibold tracking-tight">PymeBOT</span>
        </div>

        {/* Centro: pastillas (Citas / Reprogramar) */}
        <nav className="hidden md:flex items-center gap-2">
          <Pill
            href="/dashboard/bookings"
            icon={<CalendarDays className="h-4 w-4" />}
            label="Citas"
          />
          <Pill
            href="/dashboard/reschedule"
            icon={<RefreshCcw className="h-4 w-4" />}
            label="Reprogramar"
          />
        </nav>

        {/* Derecha: campana + usuario + selector tenant + salir */}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="relative inline-flex items-center justify-center rounded-full border border-white/60 bg-white/90 p-2 shadow-sm hover:bg-white"
            title="Notificaciones"
          >
            <Bell className="h-4 w-4 text-gray-700" />
            {/* puntito morado */}
            <span className="absolute -top-0.5 -right-0.5 inline-block h-2 w-2 rounded-full bg-violet-500" />
          </button>

          {/* Nombre de usuario (placeholder) */}
          <span className="text-sm text-gray-700 hidden sm:inline">janselscruz</span>

          {/* Selector de negocio (tu componente) */}
          <TopTenantSelector />

          {/* Salir */}
          <Link
            href="/auth/signout"
            className="rounded-full border border-white/60 bg-white/90 px-3 py-1.5 text-sm text-gray-700 shadow-sm hover:bg-white"
          >
            Salir
          </Link>
        </div>
      </div>
    </header>
  );
}
