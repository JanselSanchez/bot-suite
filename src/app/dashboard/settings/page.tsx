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

// Normaliza a "whatsapp:+1..." si hace falta
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

// helpers fecha <-> input "datetime-local"
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

  // selector
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string>("");

  // datos básicos
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(""); // sin "whatsapp:"
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [status, setStatus] =
    useState<"active" | "inactive" | "trial" | "blocked">("active");
  const [saving, setSaving] = useState(false);

  // facturación / gate
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<number>(0);

  // recurso para el calendario
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
        const fromStorage =
          typeof window !== "undefined"
            ? localStorage.getItem(KEY_SELECTED_TENANT)
            : null;
        initial =
          fromStorage && all.some((m) => m.tenant_id === fromStorage)
            ? fromStorage
            : all[0]?.tenant_id || "";
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

  // persistir selección
  useEffect(() => {
    if (!tenantId) return;
    try {
      localStorage.setItem(KEY_SELECTED_TENANT, tenantId);
    } catch {}
  }, [tenantId]);

  // recarga al cambiar tenant
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

  // ====== GUARDADOS ======

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    const payload: Record<string, any> = {
      name: name.trim(),
      timezone,
      phone: normalizePhone(phone),
    };

    const { error } = await sb.from("tenants").update(payload).eq("id", tenantId);

    setSaving(false);
    if (error) {
      console.error(error);
      alert(error.message || "No se pudo guardar");
    } else {
      setMemberships((prev) =>
        prev.map((m) =>
          m.tenant_id === tenantId ? { ...m, tenant_name: payload.name } : m
        )
      );
      alert("Cambios guardados");
    }
  }

  // Cambiar estado legacy (editable)
  async function handleLegacyStatusChange(
    newStatus: "active" | "inactive" | "trial" | "blocked"
  ) {
    if (!tenantId) return;
    const old = status;
    setStatus(newStatus);
  
    const { error } = await sb
      .from("tenants")
      .update({ status: newStatus })
      .eq("id", tenantId);
  
    if (error) {
      // 23514 = check_violation en Postgres
      if ((error as any).code === "23514") {
        alert("Tu BD tiene un CHECK que no permite ese valor. Ajusta el constraint o deja el estado en 'active'.");
      } else {
        alert(error.message || "No se pudo actualizar el estado");
      }
      setStatus(old); // revertir en UI
    }
  }
  

  async function updateField(patch: Partial<{ valid_until: string | null; grace_days: number }>) {
    if (!tenantId) return;
    const { error } = await sb.from("tenants").update(patch).eq("id", tenantId);
    if (error) {
      console.error("update tenants error:", error);
      alert("No se pudo guardar. Revisa consola.");
    }
  }

  async function handleSaveValidUntil(e: React.FormEvent) {
    e.preventDefault();
    // `validUntil` ya está en ISO por el onChange => guardamos tal cual
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

  // Suspender ahora: mueve la fecha al pasado más allá de la gracia actual
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

  // ====== Estado calculado (igual que el webhook) ======
  const computedStatus = useMemo<"active" | "past_due" | "suspended">(() => {
    if (!validUntil) return "active";
    const dueMs = new Date(validUntil).getTime();
    const now = Date.now();
    const graceMs = (graceDays ?? 0) * 24 * 60 * 60 * 1000;
    if (now > dueMs + graceMs) return "suspended";
    if (now > dueMs) return "past_due";
    return "active";
  }, [validUntil, graceDays]);

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

      {/* Datos del negocio */}
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
              Se guardará como <code>whatsapp:+…</code> en el campo <b>phone</b>.
            </p>
          </div>

          {/* Estado legacy: EDITABLE */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Estado (legacy)</label>
            <select
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={status}
              onChange={(e) =>
                handleLegacyStatusChange(e.target.value as "active" | "inactive" | "trial" | "blocked")
              }
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="trial">trial</option>
              <option value="blocked">blocked</option>
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Informativo. El encendido real del bot depende de <b>Vigente</b> + <b>Gracia</b>.
            </p>
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

      {/* === Facturación / Control del bot === */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8 space-y-6">
        <div className="mb-2">
          <h2 className="text-lg font-semibold tracking-tight">Facturación y control del bot</h2>
          <p className="text-sm text-gray-500">
            El webhook bloquea el bot si el vencimiento pasó (se considera el período de gracia).
          </p>
        </div>

        {/* Estado calculado */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">Estado actual:</span>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              computedStatus === "active"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : computedStatus === "past_due"
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-rose-50 text-rose-700 border border-rose-200"
            }`}
          >
            {computedStatus === "active" ? "Activo" : computedStatus === "past_due" ? "Vencido (gracia)" : "Suspendido"}
          </span>
        </div>

        {/* Vencimiento + Gracia */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700">Vigente hasta</label>
            <form className="mt-1 flex flex-col sm:flex-row gap-3" onSubmit={handleSaveValidUntil}>
              <input
                type="datetime-local"
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                value={isoToLocalInput(validUntil)}
                onChange={(e) => setValidUntil(localInputToIso(e.target.value))}
              />
              <button className="rounded-2xl border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50" type="submit">
                Guardar fecha
              </button>
              <button
                type="button"
                onClick={handleExtend30}
                className="rounded-2xl border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Extender 30 días
              </button>
              <button
                type="button"
                onClick={handleSuspendNow}
                className="rounded-2xl border px-5 py-2.5 text-sm text-rose-700 hover:bg-rose-50"
              >
                Suspender ahora
              </button>
            </form>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Gracia (días)</label>
            <input
              type="number"
              min={0}
              className="mt-1 w-32 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              value={graceDays}
              onChange={(e) => setGraceDays(Number(e.target.value))}
              onBlur={handleSaveGrace}
            />
            <p className="mt-1 text-xs text-gray-400">
              Tras vencer + gracia, el estado pasa a <b>Suspended</b>.
            </p>
          </div>
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
        {tenantId ? <ExceptionsTable tenantId={tenantId} resourceId={resourceId} /> : null}
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
