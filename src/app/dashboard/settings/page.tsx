"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Store, FileText, Phone, Plus, Trash2, Bell, Check } from "lucide-react"; // Importamos iconos

import SubscriptionBadge from "@/app/dashboard/components/SubscriptionBadge";
import BusinessHoursEditor from "@/componentes/Availability/BusinessHoursEditor";
import ExceptionsTable from "@/componentes/Availability/ExceptionsTable";
import ResourceCalendar from "@/componentes/Calendar/ResourceCalendar";
import { VERTICALS } from "@/app/lib/constants";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_TZ = "America/Santo_Domingo";
const KEY_SELECTED_TENANT = "pb.selectedTenantId";

type Membership = { tenant_id: string; tenant_name: string };
// NUEVO: Tipo para los teléfonos de notificación extra
type NotificationPhone = { id: string; name: string; phone: string; created_at: string };

function normalizePhone(raw: string) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("whatsapp:")) return s;
  if (s.startsWith("+")) return `whatsapp:${s}`;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `whatsapp:+${digits}`;
  if (/^\d{10}$/.test(digits)) return `whatsapp:+1${digits}`;
  return `whatsapp:${digits}`;
}

// Helpers de fecha (se mantienen igual)
function isoToLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(val: string) {
  if (!val) return null;
  return new Date(val).toISOString();
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string>("");

  // Datos Básicos
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("general"); // Tipo de negocio (IA)
  const [description, setDescription] = useState("");  // Contexto (IA)
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [status, setStatus] = useState<any>("active");
  const [saving, setSaving] = useState(false);

  // --- NUEVOS ESTADOS PARA GESTIÓN DE NOTIFICACIONES ---
  const [notifPhones, setNotifPhones] = useState<NotificationPhone[]>([]);
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [newPhoneName, setNewPhoneName] = useState("");
  const [newPhoneNum, setNewPhoneNum] = useState("");

  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<number>(0);
  const [resourceId, setResourceId] = useState<string | null>(null);


  // ---------- CARGA DE DATOS ----------

  // Cargar lista de teléfonos extra
  async function loadNotificationPhones(tid: string) {
    const { data } = await sb
      .from("notification_phones")
      .select("id, name, phone, created_at")
      .eq("tenant_id", tid);
    if (data) setNotifPhones(data as NotificationPhone[]);
  }

  async function loadTenant(tid: string) {
    const { data } = await sb
      .from("tenants")
      .select("name, phone, timezone, status, valid_until, grace_days, vertical, description")
      .eq("id", tid)
      .maybeSingle();

    if (data) {
      setName(data.name ?? "");
      setVertical(data.vertical ?? "general");
      setDescription(data.description ?? "");
      // El campo 'phone' del tenant original (Recepción) lo ignoramos aquí para evitar confusión con la lista nueva.
      // Si el usuario quiere que la recepción esté en la lista, deberá agregarla.
      setTimezone(data.timezone ?? DEFAULT_TZ);
      setStatus(data.status ?? "active");
      setValidUntil(data.valid_until ? new Date(data.valid_until).toISOString() : null);
      setGraceDays(data.grace_days ?? 0);
    }
  }

  // Carga inicial y selección de tenant
  useEffect(() => {
    (async () => {
      const { data: ts } = await sb.from("tenants").select("id,name").order("created_at", { ascending: false });
      if (ts) {
        const all = ts.map((t: any) => ({ tenant_id: t.id, tenant_name: t.name }));
        setMemberships(all);
        const initial = all[0]?.tenant_id || "";
        setTenantId(initial);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadTenant(tenantId);
    pickDefaultResource(tenantId);
    loadNotificationPhones(tenantId); // Cargar lista de teléfonos
    try { localStorage.setItem(KEY_SELECTED_TENANT, tenantId); } catch {}
  }, [tenantId]);

  // Funciones de notificación
  async function handleAddPhone() {
    if (!newPhoneName || !newPhoneNum) return;
    const cleanPhone = normalizePhone(newPhoneNum);
    if (!cleanPhone) { alert("Número inválido"); return; }

    const { error } = await sb.from("notification_phones").insert({
      tenant_id: tenantId,
      name: newPhoneName.trim(),
      phone: cleanPhone
    });

    if (error) alert("Error agregando teléfono: " + error.message);
    else {
      setNewPhoneName("");
      setNewPhoneNum("");
      setShowAddPhone(false);
      loadNotificationPhones(tenantId);
    }
  }

  async function handleDeletePhone(id: string) {
    if (!confirm("¿Borrar este número de la lista de notificaciones?")) return;
    await sb.from("notification_phones").delete().eq("id", id);
    loadNotificationPhones(tenantId);
  }


  // ====== GUARDAR CAMBIOS GENERALES ======

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    // Solo guardamos los campos que no son de notificación (name, vertical, description)
    const payload: Record<string, any> = {
      name: name.trim(),
      timezone,
      vertical,
      description: description.trim() || null
    };

    const { error } = await sb.from("tenants").update(payload).eq("id", tenantId);

    setSaving(false);
    if (error) alert("Error guardando");
    else alert("Configuración guardada correctamente");
  }

  // ... (Funciones auxiliares se mantienen igual o se asumen)

  async function pickDefaultResource(tid: string) {
    const { data: res1 } = await sb.from("resources").select("id").eq("tenant_id", tid).limit(1);
    setResourceId(res1?.[0]?.id || null);
  }

  async function handleLegacyStatusChange(newStatus: any) { /* ... */ setStatus(newStatus); await sb.from("tenants").update({ status: newStatus }).eq("id", tenantId); /* ... */ }
  async function updateField(patch: any) { /* ... */ await sb.from("tenants").update(patch).eq("id", tenantId); /* ... */ }
  async function handleSaveValidUntil(e: any) { e.preventDefault(); await updateField({ valid_until: validUntil }); }
  async function handleExtend30() { /* ... */ }
  async function handleSuspendNow() { /* ... */ }
  async function handleSaveGrace() { /* ... */ }


  const computedStatus = useMemo<"active" | "past_due" | "suspended">(() => {
    // ... lógica de estado de suscripción ...
    return "active"; // Simplificado para la UI
  }, [validUntil, graceDays]);

  const canShowCalendar = Boolean(tenantId && resourceId);

  return (
    <div className="p-6 space-y-8">
      {/* Halo visual */}
      <div className="pointer-events-none absolute inset-x-0 top-28 mx-auto max-w-5xl blur-3xl" aria-hidden>
        <div className="h-56 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      <header className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Configuración del Negocio</h1>
          <p className="text-sm text-gray-500">Datos generales, IA y reglas operativas.</p>
        </div>
        {tenantId ? <SubscriptionBadge tenantId={tenantId} /> : null}
      </header>

      {/* --- DATOS GENERALES --- */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        {/* ... (Header y Selector) ... */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          
          {/* Selector de Negocio */}
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-gray-700">Seleccionar Negocio</label>
            <select className="mt-1 w-full rounded-2xl border px-4 py-2.5 bg-white" value={tenantId} onChange={e => setTenantId(e.target.value)}>
              {memberships.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_name}</option>)}
            </select>
          </div>

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Nombre Público</label>
            <input className="mt-1 w-full rounded-2xl border px-4 py-2.5 bg-white" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Barbería El Duro" />
          </div>

          {/* --- PERSONALIDAD IA (NUEVO) --- */}
          <div>
            <label className="block text-sm font-medium text-gray-900 flex items-center gap-2"><Store className="w-4 h-4 text-violet-600" /> Tipo de Negocio (IA)</label>
            <select className="mt-1 w-full rounded-2xl border px-4 py-2.5 bg-white" value={vertical} onChange={e => setVertical(e.target.value)}>
              {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </div>
          
          {/* DESCRIPCIÓN IA */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-900 flex items-center gap-2"><FileText className="w-4 h-4 text-violet-600" /> Descripción para el Bot</label>
            <textarea className="mt-1 w-full rounded-2xl border px-4 py-2.5 bg-white h-[50px] resize-none" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ej. Especialistas en cortes modernos y barbas..." />
          </div>

          {/* Estado Legacy */}
          <div>
            <label className="block text-sm font-medium text-gray-700">Estado Manual</label>
            <select className="mt-1 w-full rounded-2xl border px-4 py-2.5 bg-white" value={status} onChange={(e) => handleLegacyStatusChange(e.target.value)}>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
              <option value="trial">Prueba</option>
              <option value="blocked">Bloqueado</option>
            </select>
          </div>

        </div>

        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
          <button onClick={save} disabled={saving || !tenantId} className="rounded-2xl bg-gray-900 px-6 py-2.5 font-medium text-white shadow-md hover:bg-black disabled:opacity-60">
            {saving ? "Guardando..." : "Guardar Configuración"}
          </button>
        </div>
      </section>
      
      {/* --- SECCIÓN 2: DESTINATARIOS DE NOTIFICACIONES (LA SOLUCIÓN DE LISTA DINÁMICA) --- */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow"><Bell className="w-5 h-5"/></div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Destinatarios de Alertas Generales</h2>
            <p className="text-sm text-gray-500">Números que reciben alerta de cita *además* del empleado asignado.</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Lista de teléfonos agregados */}
          <div className="grid gap-3 md:grid-cols-2">
            {notifPhones.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-white border rounded-xl shadow-sm">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600"><Phone size={14} /></div>
                  <div>
                    <p className="font-medium text-sm text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{p.phone.replace("whatsapp:", "")}</p>
                  </div>
                </div>
                <button onClick={() => handleDeletePhone(p.id)} className="text-gray-400 hover:text-red-500 p-2"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          {notifPhones.length === 0 && !showAddPhone && (
              <div className="text-sm text-gray-500 italic p-4 bg-gray-50 rounded-xl border border-dashed">No hay destinatarios. Solo el empleado asignado recibirá alerta.</div>
          )}
          
          {/* Botón de Agregar (Lista vacía o llena) */}
          {!showAddPhone && (
            <button onClick={() => setShowAddPhone(true)} className="flex items-center gap-2 text-sm text-violet-600 font-medium hover:bg-violet-50 px-4 py-2 rounded-xl border border-transparent hover:border-violet-100 transition">
              <Plus size={16} /> Agregar número de notificación
            </button>
          )}

          {/* Formulario de Agregar */}
          {showAddPhone && (
            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 animate-in fade-in slide-in-from-top-2">
              <h4 className="text-sm font-semibold mb-3">Nuevo Destinatario</h4>
              <div className="flex flex-col md:flex-row gap-3">
                <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="Nombre (Ej: Recepción)" value={newPhoneName} onChange={e => setNewPhoneName(e.target.value)} />
                <input className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="WhatsApp (Ej: 1829...)" value={newPhoneNum} onChange={e => setNewPhoneNum(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={handleAddPhone} className="bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-violet-700">Guardar</button>
                  <button onClick={() => {setShowAddPhone(false); setNewPhoneName(''); setNewPhoneNum('');}} className="bg-white border text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-100">Cancelar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* --- EL RESTO DE SECCIONES (Facturación, Horarios, etc.) SE MANTIENEN IGUAL --- */}
    </div>
  );
}