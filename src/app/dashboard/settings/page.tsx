"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

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

// Normaliza a "whatsapp:+1..."
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

// Helpers de fecha
function isoToLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function localInputToIso(val: string) {
  if (!val) return null;
  const dt = new Date(val);
  return dt.toISOString();
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Selector de Tenant
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string>("");

  // Datos Básicos
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // Número de recepción/notificaciones
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [status, setStatus] = useState<"active" | "inactive" | "trial" | "blocked">("active");
  const [saving, setSaving] = useState(false);

  // Facturación
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<number>(0);

  // Recurso para calendario
  const [resourceId, setResourceId] = useState<string | null>(null);

  // ---------- CARGA INICIAL ----------
  useEffect(() => {
    (async () => {
      const { data: ts, error: tErr } = await sb
        .from("tenants")
        .select("id,name")
        .order("created_at", { ascending: false });

      if (tErr) {
        console.error("select tenants error:", tErr);
        setLoading(false);
        return;
      }

      const all: Membership[] = (ts || []).map((t: any) => ({
        tenant_id: t.id,
        tenant_name: t.name,
      }));
      setMemberships(all);

      let initial = "";
      try {
        const fromStorage = typeof window !== "undefined" ? localStorage.getItem(KEY_SELECTED_TENANT) : null;
        initial = fromStorage && all.some((m) => m.tenant_id === fromStorage) ? fromStorage : all[0]?.tenant_id || "";
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

  useEffect(() => {
    if (!tenantId) return;
    try { localStorage.setItem(KEY_SELECTED_TENANT, tenantId); } catch {}
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      await loadTenant(tenantId);
      await pickDefaultResource(tenantId);
    })();
  }, [tenantId]);

  async function loadTenant(tid: string) {
    const { data, error } = await sb
      .from("tenants")
      .select("name, phone, timezone, status, valid_until, grace_days")
      .eq("id", tid)
      .maybeSingle();

    if (error) {
      console.error("loadTenant error:", error);
      return;
    }

    const t = data ?? null;
    if (!t) {
      setName("");
      setPhone("");
      setTimezone(DEFAULT_TZ);
      setStatus("active");
      setValidUntil(null);
      setGraceDays(0);
      return;
    }

    setName(t.name ?? "");
    setPhone((t.phone ?? "").replace(/^whatsapp:/i, ""));
    setTimezone(t.timezone ?? DEFAULT_TZ);
    setStatus((t.status as any) ?? "active");
    setValidUntil(t.valid_until ? new Date(t.valid_until as string).toISOString() : null);
    setGraceDays(Number.isFinite(t.grace_days) ? Number(t.grace_days) : 0);
  }

  async function pickDefaultResource(tid: string) {
    let rid: string | null = null;
    const { data: res1 } = await sb.from("resources").select("id").eq("tenant_id", tid).limit(1);
    rid = res1?.[0]?.id ?? null;
    setResourceId(rid);
  }

  // ====== GUARDAR CAMBIOS ======

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    const payload: Record<string, any> = {
      name: name.trim(),
      timezone,
      phone: normalizePhone(phone), // Se guarda con formato whatsapp:+1...
    };

    const { error } = await sb.from("tenants").update(payload).eq("id", tenantId);

    setSaving(false);
    if (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar");
    } else {
      setMemberships((prev) =>
        prev.map((m) => (m.tenant_id === tenantId ? { ...m, tenant_name: payload.name } : m))
      );
      alert("Configuración guardada correctamente");
    }
  }

  // Cambiar estado legacy
  async function handleLegacyStatusChange(newStatus: "active" | "inactive" | "trial" | "blocked") {
    if (!tenantId) return;
    const old = status;
    setStatus(newStatus);
    const { error } = await sb.from("tenants").update({ status: newStatus }).eq("id", tenantId);
    if (error) {
      if ((error as any).code === "23514") {
        alert("Restricción de base de datos impide este estado.");
      } else {
        alert(error.message || "Error actualizando estado");
      }
      setStatus(old);
    }
  }

  async function updateField(patch: Partial<{ valid_until: string | null; grace_days: number }>) {
    if (!tenantId) return;
    const { error } = await sb.from("tenants").update(patch).eq("id", tenantId);
    if (error) alert("Error al guardar campo.");
  }

  async function handleSaveValidUntil(e: React.FormEvent) {
    e.preventDefault();
    await updateField({ valid_until: validUntil });
  }

  async function handleExtend30() {
    const base = validUntil ? new Date(validUntil) : new Date();
    const next = new Date(base.getTime());
    next.setMonth(next.getMonth() + 1);
    const iso = next.toISOString();
    setValidUntil(iso);
    await updateField({ valid_until: iso });
  }

  async function handleSuspendNow() {
    const ms = ((graceDays ?? 0) + 1) * 24 * 60 * 60 * 1000;
    const past = new Date(Date.now() - ms).toISOString();
    setValidUntil(past);
    await updateField({ valid_until: past });
  }

  async function handleSaveGrace() {
    const g = Number(graceDays || 0);
    setGraceDays(g);
    await updateField({ grace_days: g });
  }

  const computedStatus = useMemo<"active" | "past_due" | "suspended">(() => {
    if (!validUntil) return "active";
    const dueMs = new Date(validUntil).getTime();
    const now = Date.now();
    const graceMs = (graceDays ?? 0) * 24 * 60 * 60 * 1000;
    if (now > dueMs + graceMs) return "suspended";
    if (now > dueMs) return "past_due";
    return "active";
  }, [validUntil, graceDays]);

  const canShowCalendar = useMemo<boolean>(() => Boolean(tenantId && resourceId), [tenantId, resourceId]);

  return (
    <div className="p-6 space-y-8">
      {/* Halo visual */}
      <div className="pointer-events-none absolute inset-x-0 top-28 mx-auto max-w-5xl blur-3xl" aria-hidden>
        <div className="h-56 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      <header className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Configuración del Negocio</h1>
          <p className="text-sm text-gray-500">Datos generales, notificaciones y horarios.</p>
        </div>
        {tenantId ? <SubscriptionBadge tenantId={tenantId} /> : null}
      </header>

      {/* --- DATOS DEL NEGOCIO --- */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow">
            ⚙️
          </div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Datos Generales</h2>
            <p className="text-sm text-gray-500">Información pública y de contacto.</p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          
          {/* Selector de Negocio */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700">Seleccionar Negocio</label>
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
            {!memberships.length && <p className="mt-2 text-sm text-gray-500">No hay negocios aún.</p>}
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Nombre Público</label>
            <input
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Barbería El Duro"
            />
          </div>

          {/* --- TELÉFONO DE NOTIFICACIONES (IMPORTANTE) --- */}
          <div>
            <label className="block text-sm font-medium text-gray-900">
              WhatsApp (Recepción / Notificaciones)
            </label>
            <input
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              placeholder="Ej: 18295550000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-violet-600 font-medium">
              🔔 A este número llegarán las alertas de citas.
            </p>
          </div>

          {/* Estado Legacy */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Estado Manual</label>
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={status}
              onChange={(e) => handleLegacyStatusChange(e.target.value as any)}
            >
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="trial">Prueba</option>
              <option value="blocked">Bloqueado</option>
            </select>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3 border-t pt-4">
          <button
            type="button"
            onClick={() => router.push("/dashboard/tenants/new")}
            className="rounded-2xl border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
          >
            + Nuevo negocio
          </button>
          <button
            onClick={save}
            disabled={saving || !tenantId}
            className="rounded-2xl bg-gray-900 px-6 py-2.5 font-medium text-white shadow-md transition hover:bg-black hover:shadow-lg active:scale-[.98] disabled:opacity-60"
          >
            {saving ? "Guardando..." : "Guardar Configuración"}
          </button>
        </div>
      </section>

      {/* === Facturación === */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8 space-y-6">
        <div className="mb-2">
          <h2 className="text-lg font-semibold tracking-tight">Suscripción y Vencimiento</h2>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-sm text-gray-600">Estado Calculado:</span>
            <span className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              computedStatus === "active" ? "bg-emerald-100 text-emerald-700" : 
              computedStatus === "past_due" ? "bg-amber-100 text-amber-700" : 
              "bg-red-100 text-red-700"
            }`}>
              {computedStatus === "active" ? "Activo" : computedStatus === "past_due" ? "Gracia" : "Suspendido"}
            </span>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Fecha de Vencimiento</label>
            <form className="mt-1 flex flex-col sm:flex-row gap-3" onSubmit={handleSaveValidUntil}>
              <input
                type="datetime-local"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px]"
                value={isoToLocalInput(validUntil)}
                onChange={(e) => setValidUntil(localInputToIso(e.target.value))}
              />
              <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" type="submit">Guardar</button>
              <button type="button" onClick={handleExtend30} className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 text-blue-600 font-medium">+30 Días</button>
              <button type="button" onClick={handleSuspendNow} className="rounded-xl border px-4 py-2 text-sm hover:bg-red-50 text-red-600 font-medium">Suspender</button>
            </form>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Días de Gracia</label>
            <input
              type="number"
              min={0}
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5"
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
              onBlur={handleSaveGrace}
            />
          </div>
        </div>
      </section>

      {/* Horarios */}
      <section className="space-y-4">
        <h2 className="text-xl font-medium text-gray-800">📅 Horarios de Atención</h2>
        {tenantId ? (
          <BusinessHoursEditor tenantId={tenantId} resourceId={resourceId} />
        ) : (
          <div className="text-sm text-gray-500">Cargando...</div>
        )}
      </section>

      {/* Excepciones */}
      <section className="space-y-4">
        <h2 className="text-xl font-medium text-gray-800">⛔ Feriados y Cierres</h2>
        {tenantId ? <ExceptionsTable tenantId={tenantId} resourceId={resourceId} /> : null}
      </section>

      {/* Calendario */}
      <section className="space-y-4 pb-10">
        <h2 className="text-xl font-medium text-gray-800">👀 Vista Previa de Agenda</h2>
        {canShowCalendar ? (
          <div className="border rounded-3xl overflow-hidden shadow-sm">
             <ResourceCalendar tenantId={tenantId} resourceId={resourceId as string} />
          </div>
        ) : (
          <div className="text-sm text-gray-500 italic p-4 border rounded-xl bg-gray-50">
            No hay recursos creados. Crea un barbero o doctor para ver el calendario.
          </div>
        )}
      </section>
    </div>
  );
}