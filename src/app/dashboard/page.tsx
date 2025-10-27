// src/app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import {
  CalendarDays,
  Users,
  MessageSquare,
  ArrowUpRight,
  PlusCircle,
} from "lucide-react";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const KEY_SELECTED_TENANT = "pb.selectedTenantId";

type KPI = {
  bookings30d: number;
  customers30d: number;
  messages30d: number;
};

type Recent = {
  id: string;
  title: string;
  created_at: string;
};

export default function DashboardHome() {
  const [loading, setLoading] = useState(true);
  const [tenantId, setTenantId] = useState<string>("");
  const [tenantName, setTenantName] = useState<string>("");

  const [kpi, setKpi] = useState<KPI>({
    bookings30d: 0,
    customers30d: 0,
    messages30d: 0,
  });
  const [recent, setRecent] = useState<Recent[]>([]);

  // ---------- Resolver tenant activo ----------
  useEffect(() => {
    (async () => {
      // 0) intenta localStorage
      let selected = "";
      try {
        const fromStorage =
          typeof window !== "undefined"
            ? localStorage.getItem(KEY_SELECTED_TENANT)
            : null;
        if (fromStorage) selected = fromStorage;
      } catch {}

      // 1) si no hay, busca por tenant_users
      if (!selected) {
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          const { data: tu } = await sb
            .from("tenant_users")
            .select("tenant_id")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (tu?.tenant_id) selected = tu.tenant_id;
        }
      }

      // 2) fallback: último tenant creado
      if (!selected) {
        const { data: t } = await sb
          .from("tenants")
          .select("id")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (t?.id) selected = t.id;
      }

      if (!selected) {
        setLoading(false);
        return;
      }

      setTenantId(selected);
      // guardar de una vez
      try { localStorage.setItem(KEY_SELECTED_TENANT, selected); } catch {}

      // nombre
      const { data: ten } = await sb
        .from("tenants")
        .select("name")
        .eq("id", selected)
        .maybeSingle();
      setTenantName(ten?.name || "Mi negocio");

      setLoading(false);
    })();
  }, []);

  // ---------- KPIs + Recientes ----------
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      // rango 30 días
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const fromISO = from.toISOString();

      // KPI: bookings en 30 días
      const { count: bkCount } = await sb
        .from("bookings")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", fromISO);

      // KPI: customers en 30 días
      const { count: cuCount } = await sb
        .from("customers")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", fromISO);

      // KPI: messages en 30 días
      const { count: msgCount } = await sb
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .gte("created_at", fromISO);

      setKpi({
        bookings30d: bkCount ?? 0,
        customers30d: cuCount ?? 0,
        messages30d: msgCount ?? 0,
      });

      // recientes: bookings más nuevos
      const { data: recentBookings } = await sb
        .from("bookings")
        .select("id, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5);

      const items: Recent[] =
        (recentBookings || []).map((b) => ({
          id: b.id,
          title: `Nueva cita #${b.id.slice(0, 6)}`,
          created_at: b.created_at,
        }));

      setRecent(items);
    })();
  }, [tenantId]);

  const hasTenant = useMemo(() => Boolean(tenantId), [tenantId]);

  if (loading) return null;

  if (!hasTenant) {
    // ---------- Empty state (sin tenant) ----------
    return (
      <div className="flex items-center justify-center py-20">
        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl px-8 py-10 text-center max-w-xl">
          <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white grid place-items-center shadow">
            ✨
          </div>
          <h2 className="text-2xl font-semibold">No tienes un negocio activo</h2>
          <p className="mt-1 text-sm text-gray-500">
            Crea o únete a un negocio para continuar usando el panel.
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

  // ---------- Dashboard “lindo” (con tenant) ----------
  return (
    <div className="space-y-8">
      {/* halo */}
      <div className="pointer-events-none absolute inset-x-0 top-28 mx-auto max-w-5xl blur-3xl" aria-hidden>
        <div className="h-56 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Bienvenido, <span className="text-violet-700">{tenantName}</span>
          </h1>
          <p className="text-sm text-gray-500">
            Resumen de los últimos 30 días.
          </p>
        </div>

        <Link
          href="/dashboard/settings"
          className="rounded-2xl border px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Configuración
        </Link>
      </div>

      {/* KPIs */}
      <div className="relative z-10 grid gap-4 md:grid-cols-3">
        <KpiCard
          icon={<CalendarDays className="h-5 w-5" />}
          label="Citas (30d)"
          value={kpi.bookings30d}
          href="/dashboard/bookings"
        />
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Clientes nuevos (30d)"
          value={kpi.customers30d}
          href="/dashboard/bookings" // cambia a tu ruta de clientes si la tienes
        />
        <KpiCard
          icon={<MessageSquare className="h-5 w-5" />}
          label="Mensajes (30d)"
          value={kpi.messages30d}
          href="/dashboard/chat"
        />
      </div>

      {/* Recientes */}
      <div className="relative z-10 grid gap-4 md:grid-cols-2">
        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6">
          <h3 className="text-lg font-semibold">Actividad reciente</h3>
          <p className="text-sm text-gray-500 mb-4">
            Últimas 5 citas creadas.
          </p>

          {recent.length === 0 ? (
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
