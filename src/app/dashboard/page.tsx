// src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, Users, MessageSquare, ArrowUpRight, PlusCircle } from "lucide-react";
import { useActiveTenant } from "@/app/providers/active-tenant";

type Totals = {
  bookings: number; // total bookings del tenant activo
  tenants: number;  // total de tenants (clientes)
  messages: number; // total de mensajes
};

type Recent = {
  id: string;
  title: string;
  created_at: string;
};

export default function DashboardHome() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

  const [loadingData, setLoadingData] = useState(true);
  const [tenantName, setTenantName] = useState<string>("Mi negocio");

  const [totals, setTotals] = useState<Totals>({ bookings: 0, tenants: 0, messages: 0 });
  const [recent, setRecent] = useState<Recent[]>([]);

  // Cargar nombre del tenant (rápido; deja “Mi negocio” si no hay)
  useEffect(() => {
    if (loadingTenant) return;
    if (!tenantId) return;

    (async () => {
      try {
        const r = await fetch(`/api/admin/tenants/list`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await r.json();
        if (j?.ok) {
          const match = (j.tenants || []).find((t: any) => t.id === tenantId);
          if (match?.name) setTenantName(match.name);
        }
      } catch {
        // ignore
      }
    })();
  }, [tenantId, loadingTenant]);

  // Totales + recientes (desde /api/admin/metrics)
  useEffect(() => {
    if (loadingTenant) return;
    if (!tenantId) {
      setLoadingData(false);
      return;
    }

    (async () => {
      setLoadingData(true);
      try {
        const r = await fetch(`/api/admin/metrics?tenantId=${tenantId}`, {
          credentials: "include",
          cache: "no-store",
        });
        const j = await r.json();
        if (j?.ok) {
          setTotals(j.totals || { bookings: 0, tenants: 0, messages: 0 });
          setRecent(j.recent || []);
        } else {
          setTotals({ bookings: 0, tenants: 0, messages: 0 });
          setRecent([]);
        }
      } catch {
        setTotals({ bookings: 0, tenants: 0, messages: 0 });
        setRecent([]);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [tenantId, loadingTenant]);

  const hasTenant = useMemo(() => Boolean(tenantId), [tenantId]);
  if (loadingTenant) return null;

  if (!hasTenant) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl px-8 py-10 text-center max-w-xl">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white grid place-items-center shadow">
            ✨
          </div>
          <h2 className="text-2xl font-semibold">No tienes un negocio activo</h2>
          <p className="mt-1 text-sm text-gray-500">
            Crea o activa un negocio para continuar usando el panel.
          </p>
          <Link
            href="/dashboard/tenants/new"
            className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2.5 font-medium text-white shadow-md transition hover:bg-violet-700"
          >
            <PlusCircle className="h-5 w-5" />
            Crear mi negocio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* halo */}
      <div
        className="pointer-events-none absolute inset-x-0 top-20 mx-auto max-w-5xl blur-3xl"
        aria-hidden
      >
        <div className="h-56 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Bienvenido, <span className="text-violet-700">{tenantName}</span>
          </h1>
          <p className="text-sm text-gray-500">Resumen general (totales).</p>
        </div>

        <Link
          href="/dashboard/settings"
          className="rounded-2xl border px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Configuración
        </Link>
      </div>

      {/* KPIs – Totales */}
      <div className="relative z-10 grid gap-4 md:grid-cols-3">
        <KpiCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Citas (total)"
          value={totals.bookings}
          href="/dashboard/bookings"
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Clientes (total)"
          value={totals.tenants}
          href="/dashboard/customers"
        />
        <KpiCard
          icon={<MessageSquare className="h-5 w-5" />}
          label="Mensajes (total)"
          value={totals.messages}
          href="/dashboard/chat"
        />
      </div>

      {/* Recientes */}
      <div className="relative z-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6">
          <h3 className="text-lg font-semibold">Actividad reciente</h3>
          <p className="text-sm text-gray-500 mb-4">Últimas 5 citas creadas.</p>

          {loadingData ? (
            <div className="text-sm text-gray-500">Cargando…</div>
          ) : recent.length === 0 ? (
            <div className="text-sm text-gray-500">Sin actividad reciente.</div>
          ) : (
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.id} className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/bookings`}
                    className="inline-flex items-center gap-1 text-sm text-violet-700 hover:underline"
                  >
                    Ver <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6">
          <h3 className="text-lg font-semibold">Accesos rápidos</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <QuickAction href="/dashboard/tenants/new" label="Nuevo negocio" />
            <QuickAction href="/dashboard/bookings" label="Crear cita" />
            <QuickAction href="/dashboard/templates" label="Plantillas" />
            <QuickAction href="/dashboard/settings" label="Horarios" />
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  href?: string;
}) {
  const body = (
    <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-5 hover:shadow-2xl transition">
      <div className="flex items-center justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
          {icon}
        </div>
        <div className="text-2xl font-semibold">{value}</div>
      </div>
      <p className="mt-3 text-sm text-gray-600">{label}</p>
    </div>
  );

  if (!href) return body;
  return (
    <Link href={href} className="block">
      {body}
    </Link>
  );
}

function QuickAction({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-2xl border px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-center"
    >
      {label}
    </Link>
  );
}
