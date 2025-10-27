// src/app/dashboard/settings/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

// UI tuyas
import SubscriptionBadge from "@/app/dashboard/components/SubscriptionBadge";
import BusinessHoursEditor from "@/componentes/Availability/BusinessHoursEditor";
import ExceptionsTable from "@/componentes/Availability/ExceptionsTable";
import ResourceCalendar from "@/componentes/Calendar/ResourceCalendar";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_TZ = "America/Santo_Domingo";
const KEY_SELECTED_TENANT = "pb.selectedTenantId";

type Membership = { tenant_id: string; tenant_name: string };

function normalizePhone(raw: string) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("whatsapp:")) return s;
  if (s.startsWith("+")) return `whatsapp:${s}`;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  if (/^\d{10}$/.test(digits)) return `whatsapp:+1${digits}`;
  return `whatsapp:${digits}`;
}

export default function SettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  // selector de negocio
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string>("");

  // datos editables del tenant
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // sin "whatsapp:"
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [status, setStatus] = useState("active");
  const [saving, setSaving] = useState(false);

  // resource actual para Availability/Calendar
  const [resourceId, setResourceId] = useState<string | null>(null);

  // ---------- CARGA INICIAL: lista de tenants + selección inicial ----------
  useEffect(() => {
    (async () => {
      // 1) lista completa de tenants (así ves los 3 que ya tienes)
      const { data: ts, error: tErr } = await sb
        .from("tenants")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (tErr) {
        console.error("select tenants error:", tErr);
        setLoading(false);
        return;
      }

      const all: Membership[] = (ts || []).map((t) => ({
        tenant_id: t.id,
        tenant_name: t.name,
      }));
      setMemberships(all);

      // 2) selección inicial: localStorage → primero de la lista
      let initial = "";
      try {
        const fromStorage =
          typeof window !== "undefined"
            ? localStorage.getItem(KEY_SELECTED_TENANT)
            : null;
        if (fromStorage && all.some((m) => m.tenant_id === fromStorage)) {
          initial = fromStorage;
        } else {
          initial = all[0]?.tenant_id || "";
        }
      } catch {
        initial = all[0]?.tenant_id || "";
      }

      setTenantId(initial);

      if (initial) {
        await loadTenant(initial);
        await pickDefaultResource(initial);
      }
      setLoading(false);
    })();
  }, []);

  // persistir selección cuando cambie
  useEffect(() => {
    if (!tenantId) return;
    try {
      localStorage.setItem(KEY_SELECTED_TENANT, tenantId);
    } catch {}
  }, [tenantId]);

  // cuando cambie el tenant desde el selector, recargar datos
  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      await loadTenant(tenantId);
      await pickDefaultResource(tenantId);
    })();
  }, [tenantId]);

  async function loadTenant(tid: string) {
    const { data: t, error } = await sb
      .from("tenants")
      .select("name, phone, timezone, status")
      .eq("id", tid)
      .maybeSingle();

    if (error) {
      console.error("loadTenant error:", error);
      return;
    }

    setName(t?.name || "");
    setPhone((t?.phone || "").replace(/^whatsapp:/i, ""));
    setTimezone(t?.timezone || DEFAULT_TZ);
    setStatus(t?.status || "active");
  }

  async function pickDefaultResource(tid: string) {
    let rid: string | null = null;

    const { data: res1 } = await sb
      .from("resources")
      .select("id")
      .eq("tenant_id", tid)
      .limit(1);

    rid = res1?.[0]?.id ?? null;

    if (!rid) {
      const { data: res2 } = await sb
        .from("staff")
        .select("id")
        .eq("tenant_id", tid)
        .limit(1);
      rid = res2?.[0]?.id ?? null;
    }
    setResourceId(rid);
  }

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    const payload: Record<string, any> = {
      name: name.trim(),
      timezone,
      status, // usa valores permitidos por tu CHECK: 'active' | 'inactive' | 'trial' | 'blocked'
      phone: normalizePhone(phone),
    };

    const { error } = await sb.from("tenants").update(payload).eq("id", tenantId);

    setSaving(false);
    if (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar");
    } else {
      // refresca nombre en el selector
      setMemberships((prev) =>
        prev.map((m) =>
          m.tenant_id === tenantId ? { ...m, tenant_name: payload.name } : m
        )
      );
      alert("Cambios guardados");
    }
  }

  const canShowCalendar = useMemo<boolean>(
    () => Boolean(tenantId && resourceId),
    [tenantId, resourceId]
  );

  return (
    <div className="p-6 space-y-8">
      {/* halo premium */}
      <div
        className="pointer-events-none absolute inset-x-0 top-28 mx-auto max-w-5xl blur-3xl"
        aria-hidden
      >
        <div className="h-56 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      <header className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Configuración del Tenant</h1>
          <p className="text-sm text-gray-500">Branding, horarios y reglas operativas.</p>
        </div>
        {tenantId ? <SubscriptionBadge tenantId={tenantId} /> : null}
      </header>

      {/* Selector + edición básica */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
            ⚙️
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Datos del negocio</h2>
            <p className="text-sm text-gray-500">Nombre, WhatsApp, zona horaria y estado.</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700">Negocio</label>
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={!memberships.length}
            >
              {memberships.map((m) => (
                <option key={m.tenant_id} value={m.tenant_id}>
                  {m.tenant_name}
                </option>
              ))}
            </select>
            {!memberships.length && (
              <p className="mt-2 text-sm text-gray-500">No hay negocios aún.</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Nombre</label>
            <input
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">WhatsApp / Teléfono</label>
            <input
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              placeholder="+1829XXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">
              Se guardará como <code>whatsapp:+…</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Zona horaria</label>
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              <option value="America/Santo_Domingo">America/Santo_Domingo</option>
              <option value="America/New_York">America/New_York</option>
              <option value="America/Mexico_City">America/Mexico_City</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Estado</label>
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="trial">trial</option>
              <option value="blocked">blocked</option>
            </select>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push("/dashboard/tenants/new")}
            className="rounded-2xl border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Nuevo negocio
          </button>
          <button
            onClick={save}
            disabled={saving || !tenantId}
            className="rounded-2xl bg-violet-600 px-6 py-2.5 font-medium text-white shadow-md transition hover:bg-violet-700 hover:shadow-lg active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar cambios"}
          </button>
        </div>
      </section>

      {/* Horarios */}
      <section className="space-y-4">
        <h2 className="text-xl font-medium">Horarios de atención</h2>
        {tenantId ? (
          <BusinessHoursEditor tenantId={tenantId} resourceId={resourceId} />
        ) : (
          <div className="text-sm text-gray-500">
            {loading ? "Cargando..." : "No se pudo cargar el tenant."}
          </div>
        )}
      </section>

      {/* Excepciones */}
      <section className="space-y-4">
        <h2 className="text-xl font-medium">Excepciones / Feriados</h2>
        {tenantId ? (
          <ExceptionsTable tenantId={tenantId} resourceId={resourceId} />
        ) : null}
      </section>

      {/* Calendario */}
      <section className="space-y-4">
        <h2 className="text-xl font-medium">Vista previa de calendario</h2>
        {canShowCalendar ? (
          <ResourceCalendar tenantId={tenantId} resourceId={resourceId as string} />
        ) : (
          <div className="text-sm text-gray-500">
            {loading
              ? "Cargando calendario…"
              : "No hay recurso asignado aún. Crea un recurso o selecciona uno para ver el calendario."}
          </div>
        )}
      </section>
    </div>
  );
}
