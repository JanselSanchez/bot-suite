"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { Store, FileText, Phone, Plus, Trash2, Bell, Check, Bot, MapPin, CreditCard } from "lucide-react"; // Iconos nuevos agregados

import SubscriptionBadge from "@/app/dashboard/components/SubscriptionBadge";
import { VERTICALS } from "@/app/lib/constants";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_TZ = "America/Santo_Domingo";
const KEY_SELECTED_TENANT = "pb.selectedTenantId";

type Membership = { tenant_id: string; tenant_name: string };
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

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenantId, setTenantId] = useState<string>("");

  // Datos Básicos (Tenants)
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [status, setStatus] = useState<any>("active");
  const [validUntil, setValidUntil] = useState<string | null>(null);
  const [graceDays, setGraceDays] = useState<number>(0);
  
  // --- DATOS DEL CEREBRO DEL BOT (business_profiles) ---
  const [botName, setBotName] = useState("");
  const [botTone, setBotTone] = useState("Amable y profesional");
  const [vertical, setVertical] = useState("general"); 
  const [address, setAddress] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [googleMapsLink, setGoogleMapsLink] = useState("");

  const [saving, setSaving] = useState(false);

  // --- NUEVOS ESTADOS PARA GESTIÓN DE NOTIFICACIONES ---
  const [notifPhones, setNotifPhones] = useState<NotificationPhone[]>([]);
  const [showAddPhone, setShowAddPhone] = useState(false);
  const [newPhoneName, setNewPhoneName] = useState("");
  const [newPhoneNum, setNewPhoneNum] = useState("");

  // ---------- CARGA DE DATOS ----------

  async function loadNotificationPhones(tid: string) {
    const { data } = await sb
      .from("notification_phones")
      .select("id, name, phone, created_at")
      .eq("tenant_id", tid);
    if (data) setNotifPhones(data as NotificationPhone[]);
  }

  // Carga Tenant + Perfil de Negocio (JOIN lógico)
  async function loadTenant(tid: string) {
    // 1. Cargar Datos Básicos (Tabla tenants)
    const { data: tenant } = await sb
      .from("tenants")
      .select("name, timezone, status, valid_until, grace_days")
      .eq("id", tid)
      .maybeSingle();

    if (tenant) {
      setName(tenant.name ?? "");
      setTimezone(tenant.timezone ?? DEFAULT_TZ);
      setStatus(tenant.status ?? "active");
      setValidUntil(tenant.valid_until ? new Date(tenant.valid_until).toISOString() : null);
      setGraceDays(tenant.grace_days ?? 0);
    }

    // 2. Cargar Cerebro del Bot (Tabla business_profiles)
    const { data: profile } = await sb
      .from("business_profiles")
      .select("*")
      .eq("tenant_id", tid)
      .maybeSingle();

    if (profile) {
      setBotName(profile.bot_name || "");
      setBotTone(profile.bot_tone || "Amable y profesional");
      setVertical(profile.business_type || "general");
      setAddress(profile.address || "");
      setGoogleMapsLink(profile.google_maps_link || "");
      setCustomInstructions(profile.custom_instructions || "");
    } else {
      // Valores por defecto si no existe perfil aún
      setBotName("Asistente Virtual");
      setBotTone("Amable y profesional");
      setVertical("general");
      setAddress("");
      setCustomInstructions("");
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
    loadNotificationPhones(tenantId);
    try { localStorage.setItem(KEY_SELECTED_TENANT, tenantId); } catch {}
  }, [tenantId]);

  // Funciones de notificación (Se mantienen igual)
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

  // ====== GUARDAR CAMBIOS GENERALES Y DE PERFIL ======

  async function save() {
    if (!tenantId) return;
    setSaving(true);

    // 1. Guardar en 'tenants' (Datos administrativos)
    const tenantPayload = {
      name: name.trim(),
      timezone,
    };
    const { error: errTenant } = await sb.from("tenants").update(tenantPayload).eq("id", tenantId);

    // 2. Guardar en 'business_profiles' (Datos del Bot/IA)
    // Usamos upsert por si no existe la fila todavía
    const profilePayload = {
      tenant_id: tenantId,
      bot_name: botName.trim(),
      bot_tone: botTone,
      business_type: vertical,
      address: address.trim(),
      google_maps_link: googleMapsLink.trim(),
      custom_instructions: customInstructions.trim()
    };
    
    const { error: errProfile } = await sb
        .from("business_profiles")
        .upsert(profilePayload, { onConflict: "tenant_id" });

    setSaving(false);

    if (errTenant || errProfile) {
        console.error(errTenant, errProfile);
        alert("Hubo un error guardando algunos datos.");
    } else {
        alert("✅ Configuración guardada correctamente");
    }
  }

  async function handleLegacyStatusChange(newStatus: any) { 
      setStatus(newStatus); 
      await sb.from("tenants").update({ status: newStatus }).eq("id", tenantId); 
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
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

      {/* --- SECCIÓN 1: IDENTIDAD Y CEREBRO DEL BOT (MEJORADA) --- */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        
        {/* Selector Principal */}
        <div className="mb-6 pb-6 border-b border-gray-100">
            <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Negocio</label>
            <select className="w-full md:w-1/2 rounded-xl border px-4 py-2.5 bg-white" value={tenantId} onChange={e => setTenantId(e.target.value)}>
                {memberships.map(m => <option key={m.tenant_id} value={m.tenant_id}>{m.tenant_name}</option>)}
            </select>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          
          {/* COLUMNA IZQUIERDA: Identidad Básica */}
          <div className="space-y-5">
             <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide flex items-center gap-2">
                <Store className="w-4 h-4" /> Datos del Negocio
             </h3>
             
             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Nombre Público</label>
                <input className="w-full rounded-xl border px-3 py-2 bg-white" value={name} onChange={e => setName(e.target.value)} placeholder="Ej. Barbería El Duro" />
             </div>

             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Giro / Tipo de Negocio</label>
                <select className="w-full rounded-xl border px-3 py-2 bg-white" value={vertical} onChange={e => setVertical(e.target.value)}>
                    {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Define si el bot agenda citas o toma pedidos.</p>
             </div>

             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Dirección / Ubicación</label>
                <input className="w-full rounded-xl border px-3 py-2 bg-white" value={address} onChange={e => setAddress(e.target.value)} placeholder="Ej. Av. 27 de Febrero #23" />
             </div>
             
             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Link de Google Maps</label>
                <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input className="w-full rounded-xl border pl-9 pr-3 py-2 bg-white text-sm" value={googleMapsLink} onChange={e => setGoogleMapsLink(e.target.value)} placeholder="https://maps.google..." />
                </div>
             </div>
          </div>

          {/* COLUMNA DERECHA: Cerebro IA */}
          <div className="space-y-5">
             <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide flex items-center gap-2">
                <Bot className="w-4 h-4" /> Personalidad IA
             </h3>

             <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Nombre del Bot</label>
                    <input className="w-full rounded-xl border px-3 py-2 bg-white" value={botName} onChange={e => setBotName(e.target.value)} placeholder="Ej. Manolo" />
                </div>
                <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Tono de Voz</label>
                    <select className="w-full rounded-xl border px-3 py-2 bg-white" value={botTone} onChange={e => setBotTone(e.target.value)}>
                        <option value="Amable y profesional">Amable y Profesional</option>
                        <option value="Dominicano y cercano">Dominicano y Cercano</option>
                        <option value="Vendedor entusiasta">Vendedor Entusiasta</option>
                        <option value="Formal y médico">Formal y Médico</option>
                    </select>
                </div>
             </div>

             <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center gap-2">
                    <FileText className="w-3 h-3" /> Reglas de Oro (Instrucciones)
                </label>
                <textarea 
                    className="w-full rounded-xl border px-4 py-3 bg-white h-[120px] text-sm leading-relaxed" 
                    value={customInstructions} 
                    onChange={e => setCustomInstructions(e.target.value)} 
                    placeholder="- No aceptamos American Express.&#10;- El delivery cuesta 150 pesos.&#10;- Los viernes cerramos a las 3pm." 
                />
                <p className="text-xs text-gray-400 mt-1">Escribe aquí reglas libres que el bot debe respetar siempre.</p>
             </div>
          </div>

        </div>

        <div className="mt-8 flex items-center justify-between border-t pt-6">
            <div className="flex items-center gap-2">
                <label className="text-sm text-gray-600">Estado del Sistema:</label>
                <select className="rounded-lg border px-2 py-1 text-sm bg-gray-50" value={status} onChange={(e) => handleLegacyStatusChange(e.target.value)}>
                    <option value="active">Activo</option>
                    <option value="inactive">Inactivo (Pausar Bot)</option>
                </select>
            </div>
            
            <button onClick={save} disabled={saving || !tenantId} className="rounded-xl bg-black px-8 py-3 font-medium text-white shadow-lg hover:bg-gray-800 disabled:opacity-60 transition-transform active:scale-95 flex items-center gap-2">
                {saving ? "Guardando..." : <><Check size={18}/> Guardar Cambios</>}
            </button>
        </div>
      </section>
      
      {/* --- SECCIÓN 2: DESTINATARIOS DE NOTIFICACIONES (Igual que antes) --- */}
      <section className="relative z-10 rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl p-6 md:p-8">
        <div className="mb-6 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow"><Bell className="w-5 h-5"/></div>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Notificaciones de Equipo</h2>
            <p className="text-sm text-gray-500">¿A quién le avisamos cuando llega una cita nueva?</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {notifPhones.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-white border rounded-xl shadow-sm hover:shadow-md transition">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold">{p.name[0]}</div>
                  <div>
                    <p className="font-medium text-sm text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{p.phone.replace("whatsapp:", "")}</p>
                  </div>
                </div>
                <button onClick={() => handleDeletePhone(p.id)} className="text-gray-300 hover:text-red-500 p-2 transition"><Trash2 size={16} /></button>
              </div>
            ))}
          </div>

          {notifPhones.length === 0 && !showAddPhone && (
              <div className="text-center p-6 bg-gray-50 rounded-2xl border border-dashed border-gray-300">
                  <p className="text-gray-500 text-sm">No hay teléfonos registrados.</p>
                  <p className="text-gray-400 text-xs mt-1">El bot solo responderá al cliente, pero nadie del equipo se enterará.</p>
              </div>
          )}
          
          {!showAddPhone && (
            <button onClick={() => setShowAddPhone(true)} className="mt-2 w-full py-3 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 font-medium hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50 transition flex justify-center items-center gap-2">
              <Plus size={18} /> Agregar Teléfono
            </button>
          )}

          {showAddPhone && (
            <div className="bg-gray-50 p-5 rounded-2xl border border-gray-200 animate-in fade-in zoom-in-95">
              <h4 className="text-sm font-bold text-gray-800 mb-4">Nuevo Destinatario</h4>
              <div className="flex flex-col md:flex-row gap-3">
                <input className="flex-1 border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500" placeholder="Nombre (Ej: Recepción)" value={newPhoneName} onChange={e => setNewPhoneName(e.target.value)} />
                <input className="flex-1 border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500" placeholder="WhatsApp (Ej: 1829...)" value={newPhoneNum} onChange={e => setNewPhoneNum(e.target.value)} />
              </div>
              <div className="flex gap-3 mt-4 justify-end">
                  <button onClick={() => {setShowAddPhone(false); setNewPhoneName(''); setNewPhoneNum('');}} className="text-gray-500 text-sm font-medium hover:text-gray-700 px-4">Cancelar</button>
                  <button onClick={handleAddPhone} className="bg-black text-white px-6 py-2 rounded-xl text-sm font-bold hover:bg-gray-800 shadow-md">Guardar Teléfono</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}