// src/app/dashboard/layout.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import clsx from "clsx";
import {
  Home,
  Calendar,
  RefreshCw,
  Clock,
  Layers,
  Bot,
  Settings,
  Activity,
  LogOut,
  Bell,
} from "lucide-react";

// ⬇️ NUEVO: Provider de tenant + selector visual
import { ActiveTenantProvider } from "@/app/providers/active-tenant";
import ActiveTenantMenu from "@/componentes/ActiveTenantMenu";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const LINKS = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/dashboard/bookings", label: "Citas", icon: Calendar },
  { href: "/dashboard/reschedule", label: "Reprogramar", icon: RefreshCw },
  { href: "/dashboard/availability", label: "Disponibilidad", icon: Clock },
  { href: "/dashboard/templates", label: "Plantillas", icon: Layers },
  { href: "/dashboard/editor", label: "Editor del Bot", icon: Bot },
  { href: "/dashboard/status", label: "Estado", icon: Activity },
  { href: "/dashboard/settings", label: "Configuración", icon: Settings },
];

const TOP_LINKS = [
  { href: "/dashboard/bookings", label: "Citas", icon: Calendar },
  { href: "/dashboard/reschedule", label: "Reprogramar", icon: RefreshCw },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [userName, setUserName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (user) setUserName(user.user_metadata?.full_name || user.email || "Usuario");
    })();
  }, []);

  return (
    <ActiveTenantProvider>
      <div className="relative min-h-screen overflow-hidden text-slate-900">
        {/* ===== Fondo global unificado ===== */}
        <div className="absolute inset-0 -z-10">
          <div
            className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full blur-3xl opacity-50"
            style={{
              background:
                "radial-gradient(45% 45% at 50% 50%, #7c3aed30 0%, #6366f130 40%, transparent 70%)",
            }}
          />
          <div
            className="absolute -bottom-40 -right-24 h-[520px] w-[520px] rounded-full blur-3xl opacity-50"
            style={{
              background:
                "radial-gradient(45% 45% at 50% 50%, #06b6d430 0%, #6366f130 40%, transparent 70%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage:
                "radial-gradient(#1e293b 1px, transparent 1px), radial-gradient(#1e293b 1px, transparent 1px)",
              backgroundPosition: "0 0, 12px 12px",
              backgroundSize: "24px 24px",
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.06] mix-blend-multiply"
            style={{
              backgroundImage:
                "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/></filter><rect width=%2248%22 height=%2248%22 filter=%22url(%23n)%22 opacity=%220.15%22/></svg>')",
            }}
          />
        </div>

        {/* ===== Topbar moderno con pills ===== */}
        <header className="sticky top-0 z-40">
          <div className="mx-auto max-w-7xl px-4 pt-3 pb-2">
            <div className="rounded-2xl border border-white/40 bg-white/50 backdrop-blur-xl shadow-[0_8px_40px_rgba(31,41,55,.08)] px-4">
              <div className="h-14 flex items-center justify-between gap-4">
                {/* Brand */}
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white grid place-items-center shadow-sm">
                    ✨
                  </div>
                  <span className="font-semibold tracking-wide">PymeBOT</span>
                </div>

                {/* Centro: Pills + Selector de negocio */}
                <div className="hidden md:flex items-center gap-3">
                  {/* Nav pills */}
                  <nav className="flex items-center gap-1 rounded-full border border-white/60 bg-white/60 backdrop-blur px-1 py-1 shadow-sm">
                    {TOP_LINKS.map(({ href, label, icon: Icon }) => {
                      const active = pathname.startsWith(href);
                      return (
                        <Link
                          key={href}
                          href={href}
                          className={clsx(
                            "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition",
                            active
                              ? "relative text-white bg-gradient-to-r from-indigo-600 to-fuchsia-600 shadow before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-fuchsia-500/30 before:blur-xl"
                              : "text-slate-600 hover:bg-white"
                          )}
                        >
                          <Icon className={clsx("w-4 h-4", active ? "opacity-90" : "opacity-70")} />
                          <span>{label}</span>
                        </Link>
                      );
                    })}
                  </nav>

                  {/* Selector de negocio (píldora) — usa el estado global */}
                  <ActiveTenantMenu />
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button
                    className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/60 bg-white/70 backdrop-blur hover:bg-white transition"
                    aria-label="Notificaciones"
                  >
                    <Bell className="w-4.5 h-4.5 text-slate-600" />
                    <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-fuchsia-500 ring-2 ring-white" />
                  </button>

                  <span className="hidden sm:inline text-sm text-gray-600">👋 {userName}</span>

                  <form action="/auth/signout" method="post">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-rose-600 transition"
                    >
                      <LogOut className="w-4 h-4" /> Salir
                    </button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* ===== Body ===== */}
        <div className="mx-auto max-w-7xl px-4 py-6 grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="rounded-3xl border border-white/50 bg-white/60 backdrop-blur-xl shadow-[0_10px_40px_rgba(2,6,23,.06)] p-4">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-8 w-8 rounded-xl bg-indigo-600/10 grid place-items-center">
                <span className="text-indigo-600 font-semibold">PB</span>
              </div>
              <span className="text-sm font-medium text-slate-700">Bot Suite</span>
            </div>
            <nav className="space-y-1">
              {LINKS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      "group flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all",
                      active
                        ? "text-white shadow-sm bg-gradient-to-r from-indigo-600 to-fuchsia-600"
                        : "text-slate-600 hover:text-indigo-700 hover:bg-indigo-50"
                    )}
                  >
                    <Icon className={clsx("w-4 h-4", active ? "opacity-90" : "opacity-70 group-hover:opacity-100")} />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-6 rounded-xl bg-gradient-to-br from-indigo-50 to-fuchsia-50 border border-indigo-100 p-3 text-xs text-slate-600">
              💡 Tip: Configura tus horarios en <b>Disponibilidad</b> para que el bot ofrezca slots perfectos.
            </div>
          </aside>

          {/* Content */}
          <main className="min-h-[70vh] rounded-[26px] border border-white/60 bg-white/80 backdrop-blur-xl shadow-[0_12px_60px_rgba(2,6,23,.08)] p-8">
            {children}
          </main>
        </div>

        {/* Footer */}
        <footer className="py-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} PymeBOT — plataforma de bots para negocios con estilo 💜
        </footer>
      </div>
    </ActiveTenantProvider>
  );
}
