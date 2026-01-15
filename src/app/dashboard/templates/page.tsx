// src/app/(dashboard)/templates/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useActiveTenant } from "@/app/providers/active-tenant";
import { RefreshCcw, Wand2, Save, Eye, Copy, Check, Info } from "lucide-react";
import { VERTICALS } from "@/app/lib/constants";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEFAULT_CHANNEL = "whatsapp" as const;

// Tipos derivados de tus constantes
type VerticalValue = (typeof VERTICALS)[number]["value"];

// ✨ ACTUALIZADO: Añadido 'system_prompt' a los tipos permitidos
type EventKey =
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "reminder"
  | "payment_pending"
  | "pricing_pitch"
  | "system_prompt"; // 👈 NUEVO: El Cerebro

// ✨ ACTUALIZADO: Añadida la opción en el menú desplegable
const EVENT_OPTS: ReadonlyArray<{
  value: EventKey;
  label: string;
  hint: string;
}> = [
  {
    value: "system_prompt", // 👈 LA NUEVA OPCIÓN
    label: "🧠 Cerebro / Personalidad IA",
    hint: "Define quién es el bot, qué vende y cómo se comporta. (Instrucción Maestra)",
  },
  {
    value: "booking_confirmed",
    label: "Cita CONFIRMADA",
    hint: "Se envía automáticamente cuando se crea una cita.",
  },
  {
    value: "booking_rescheduled",
    label: "Cita REPROGRAMADA",
    hint: "Se envía cuando cambia la fecha/hora.",
  },
  {
    value: "booking_cancelled",
    label: "Cita CANCELADA",
    hint: "Se envía al cancelar.",
  },
  {
    value: "reminder",
    label: "Recordatorio",
    hint: "Recordatorio programado antes de la cita.",
  },
  {
    value: "pricing_pitch",
    label: "Info de planes / precios",
    hint: "⚠️ IMPORTANTE: El bot usará este texto EXACTO cuando pregunten precios.",
  },
];

// 🧠 CEREBRO DE SUGERENCIAS: Textos adaptados a cada negocio
// ✨ ACTUALIZADO: Agregué 'system_prompt' a cada nicho con la lógica que diseñamos.
const PRESETS: Record<string, Partial<Record<EventKey, string>>> = {
  general: {
    system_prompt: `Eres el Asistente Virtual de {{business_name}}.
Tu misión: Atender clientes, resolver dudas y filtrar interesados.

Reglas de Comportamiento:
1. Sé amable, profesional y directo.
2. Si preguntan precios, usa la información del catálogo.
3. Si el cliente está listo para comprar o tiene dudas complejas, usa la herramienta "human_handoff" o manda el contacto del dueño.

Tu objetivo NO es trabarte en conversaciones largas, es llevar al cliente al siguiente paso (Agendar o Hablar con Humano).`,
    booking_confirmed:
      "Hola {{customer_name}}, tu cita del {{date}} a las {{time}} con {{resource_name}} fue confirmada. Si deseas pagar antes: {{payment_link}}.",
    pricing_pitch:
      "Nuestros servicios van desde $500 hasta $5,000 dependiendo de lo que necesites. ¿Te gustaría agendar una evaluación?",
  },
  barbershop: {
    system_prompt: `Eres el Asistente con Flow de {{business_name}}.
Tu misión: Llenar la agenda de cortes y mantener el estilo.

Tono: Urbano, respetuoso ("mi líder", "caballero"), cercano.
Reglas:
1. Tu prioridad #1 es AGENDAR CITAS usando la herramienta.
2. Si preguntan precios, dalos directo y cierra con "¿Te anoto para hoy?".
3. No des vueltas. Corte, Barba, Cejas. Rápido y efectivo.`,
    booking_confirmed:
      "¡Todo listo, líder! 💈 {{customer_name}}, tu corte quedó para el {{date}} a las {{time}} con {{resource_name}}. Llega 5 min antes.",
    reminder:
      "Un saludo {{customer_name}}, recuerda tu recorte hoy a las {{time}}. Confírmanos si vienes.",
    pricing_pitch:
      "El corte regular cuesta $500, barba $300 y el servicio completo $800. ¿Te agendo uno para hoy?",
  },
  salon: {
    system_prompt: `Eres la Asistente de Belleza de {{business_name}}.
Tu misión: Hacer sentir especiales a las clientes y organizar las citas.

Tono: Amable, cálido, usa emojis ✨💅.
Reglas:
1. Agenda citas para secado, uñas, tintes.
2. Recuerda que los precios de tintes son "desde" y requieren evaluación.
3. Trata a cada cliente como una reina.`,
    booking_confirmed:
      "Hola bella ✨ {{customer_name}}, tu cita de belleza es el {{date}} a las {{time}} con {{resource_name}}. ¡Te esperamos!",
    pricing_pitch:
      "El lavado y secado empieza en $800. Tintes desde $2,500. Para un precio exacto necesitamos evaluarte el cabello. ¿Pasas hoy?",
  },
  clinic: {
    system_prompt: `Eres el Asistente Médico de {{business_name}}.
Tu misión: Gestionar la agenda de pacientes con profesionalismo y empatía.

Tono: Formal, respetuoso ("Estimado paciente"), serio.
Reglas:
1. Agenda citas médicas verificando disponibilidad.
2. Si es una emergencia, indica que llamen al 911 o vayan a urgencias.
3. Solicita confirmar si tienen seguro médico.`,
    booking_confirmed:
      "Estimado(a) {{customer_name}}, su consulta médica está confirmada para el {{date}} a las {{time}} con el Dr(a). {{resource_name}}.",
    reminder:
      "Recordatorio de cita médica: Paciente {{customer_name}}, hoy a las {{time}}. Favor traer su seguro.",
    pricing_pitch:
      "La consulta general tiene un costo de $2,000 (o diferencia de seguro). Especialidades varían. ¿Desea ver disponibilidad?",
  },
  restaurant: {
    system_prompt: `Eres el Camarero Virtual de {{business_name}}.
Tu misión: Antojar a los clientes, mostrar el menú y tomar reservas.

Reglas CRÍTICAS:
1. NO USES la herramienta de agendar citas (booking) a menos que sea una RESERVA DE MESA.
2. Para delivery: Muestra el menú, toma el pedido y pide la dirección.
3. Sé descriptivo con la comida 🍕🍔. ¡Que les de hambre al leerte!`,
    booking_confirmed:
      "¡Mesa reservada! 🍽️ {{customer_name}}, los esperamos el {{date}} a las {{time}}. Ver menú: {{payment_link}}",
    pricing_pitch:
      "Nuestro plato del día cuesta $450. El menú a la carta varía entre $600 y $1,500 por persona. ¡Tenemos Happy Hour de 5 a 8!",
  },
  real_estate: {
    system_prompt: `Eres el Asesor Inmobiliario IA de {{business_name}}.
Tu misión: Calificar prospectos y agendar visitas a propiedades.

Reglas:
1. No des la ubicación exacta por chat, agenda la visita.
2. Filtra presupuesto: Pregunta rango de precio y zona de interés.
3. Tu objetivo es conseguir la cita presencial.`,
    booking_confirmed:
      "Visita confirmada 🏠. {{customer_name}}, nos vemos el {{date}} a las {{time}} para ver la propiedad.",
    pricing_pitch:
      "Manejamos propiedades desde US$80,000 en planos hasta listas para entrega. ¿Buscas para vivir o inversión?",
  },
  store: {
    system_prompt: `Eres el Vendedor Digital de {{business_name}}.
Tu misión: Ayudar a encontrar productos y cerrar ventas.

Reglas:
1. Muestra el catálogo con precios.
2. Si piden algo específico, confirma si hay stock (o di que lo verificas).
3. Gestiona pedidos para pickup o envío.`,
    booking_confirmed:
      "¡Pedido recibido! 🛍️ {{customer_name}}, puedes pasar a recogerlo el {{date}} a las {{time}}.",
    pricing_pitch:
      "Tenemos artículos desde $200. Revisa nuestro catálogo completo aquí: {{payment_link}}",
  },
};

type TemplateRow = {
  id: string;
  tenant_id: string;
  channel: string;
  event: string;
  name: string | null;
  body: string;
  active: boolean;
  created_at: string;
};

const VARIABLE_HINTS = [
  "customer_name",
  "date",
  "time",
  "resource_name",
  "payment_link",
] as const;

export default function TemplatesPage() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Estado del vertical seleccionado (para sugerencias)
  const [vertical, setVertical] = useState<string>("general");
  
  // Valor por defecto del dropdown
  const [event, setEvent] = useState<EventKey>("booking_confirmed");
  
  const [idEditing, setIdEditing] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const [preview, setPreview] = useState<string>("");
  const [success, setSuccess] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  // 1. Cargar Plantillas + Detectar Tipo de Negocio
  useEffect(() => {
    if (!loadingTenant && tenantId) {
      void loadTemplates();
      void detectVertical();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, loadingTenant]);

  function resolveTenantId(): string | null {
    return tenantId ?? null;
  }

  // Detectar qué tipo de negocio es este Tenant para poner el botón correcto activo
  async function detectVertical() {
    const tId = resolveTenantId();
    if (!tId) return;
    
    const { data } = await sb
      .from("tenants")
      .select("vertical")
      .eq("id", tId)
      .single();

    if (data?.vertical) {
      setVertical(data.vertical);
    }
  }

  async function loadTemplates() {
    setLoading(true);
    const tId = resolveTenantId();
    if (!tId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await sb
      .from("message_templates")
      .select("*")
      .eq("tenant_id", tId)
      .eq("channel", DEFAULT_CHANNEL)
      .order("event", { ascending: true });

    if (!error && data) setRows(data as TemplateRow[]);
    setLoading(false);
  }

  function renderTemplate(str: string, vars: Record<string, string>) {
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : ""));
  }

  const sampleData = useMemo(
    () => ({
      customer_name: "Ana",
      date: "15/10/2025",
      time: "10:30 a. m.",
      resource_name: "Laura",
      payment_link: "https://link.pago...",
    }),
    []
  );

  function applyPreset() {
    // Busca el preset exacto, si no, busca en 'general'
    const preset = PRESETS[vertical]?.[event] || PRESETS["general"]?.[event];
    if (preset) setBody(preset);
  }

  function insertVariable(v: string) {
    const tag = `{{${v}}}`;
    if (!bodyRef.current) {
      setBody((b) => `${b}${tag}`);
      return;
    }
    const el = bodyRef.current;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + tag + el.value.slice(end);
    setBody(next);
    setTimeout(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  }

  function resetForm() {
    setIdEditing(null);
    setName("");
    setBody("");
    setActive(true);
    setPreview("");
  }

  function doPreview() {
    setPreview(renderTemplate(body || "", sampleData));
  }

  async function save() {
    const tId = resolveTenantId();
    if (!tId) {
      alert("No hay tenant activo.");
      return;
    }

    setSuccess(null);
    const isNew = !idEditing;

    const payload = {
      id: idEditing ?? undefined,
      tenant_id: tId,
      channel: DEFAULT_CHANNEL,
      event,
      name: name || null,
      body,
      active,
      vertical: vertical 
    };

    const { data, error } = await sb
      .from("message_templates")
      .upsert(payload, { onConflict: "id" })
      .select("id")
      .single();

    if (error) {
      console.error("[templates/save] error:", error);
      alert("No se pudo guardar la plantilla.");
      return;
    }

    setIdEditing(data?.id ?? null);
    if (isNew) resetForm();

    setSuccess("Plantilla guardada correctamente.");
    setTimeout(() => setSuccess(null), 3000);
    await loadTemplates();
  }

  async function toggleActive(row: TemplateRow) {
    const { error } = await sb
      .from("message_templates")
      .update({ active: !row.active })
      .eq("id", row.id);

    if (!error) {
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r))
      );
    }
  }

  function startEdit(row: TemplateRow) {
    setIdEditing(row.id);
    setName(row.name ?? "");
    setBody(row.body);
    setActive(row.active);
    
    // Intentar encontrar el evento en la lista
    const evFound = EVENT_OPTS.find((e) => e.value === row.event)?.value;
    
    // Si es system_prompt o cualquier otro válido, lo seteamos
    if (evFound) setEvent(evFound as EventKey);
    // Si no está en la lista (legacy), lo dejamos como está o forzamos general (opcional)
    
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const currentEventMeta = EVENT_OPTS.find((o) => o.value === event) ?? EVENT_OPTS[0];

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plantillas</h1>
          <p className="text-sm text-gray-500">
            Define los mensajes y la personalidad que el Bot usará.
          </p>
        </div>
        <button
          onClick={() => void loadTemplates()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 border hover:bg-gray-50 transition disabled:opacity-60"
        >
          <RefreshCcw className="w-4 h-4" />
          Refrescar
        </button>
      </div>

      {/* Selector de Vertical (Contexto) */}
      <div className="rounded-2xl border bg-white/60 backdrop-blur p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold text-sm">Estilo de Negocio (Sugerencias)</h2>
          <p className="text-xs text-gray-400 mb-2">Selecciona uno para ver ejemplos de redacción:</p>
          <div className="flex flex-wrap gap-2">
            {VERTICALS.map((v) => (
              <button
                key={v.value}
                onClick={() => setVertical(v.value)}
                className={[
                  "px-3 py-1.5 rounded-full border text-xs transition",
                  vertical === v.value
                    ? "bg-gray-900 text-white border-gray-900"
                    : "hover:bg-gray-50 bg-white text-gray-600",
                ].join(" ")}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t pt-4">
          <label className="text-sm font-medium text-gray-700">Evento (¿Cuándo se envía?)</label>
          <div className="flex flex-col md:flex-row gap-3 mt-1">
            <select
              className="border rounded-xl px-3 py-2 w-full md:w-1/2 bg-white"
              value={event}
              onChange={(e) => setEvent(e.target.value as EventKey)}
            >
              {EVENT_OPTS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            
            <button
              onClick={applyPreset}
              className="inline-flex justify-center items-center gap-2 rounded-xl border px-4 py-2 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition bg-white"
              title="Pegar redacción sugerida"
            >
              <Wand2 className="w-4 h-4" />
              <span>Usar sugerencia para {VERTICALS.find(v => v.value === vertical)?.label}</span>
            </button>
          </div>
          
          <div className="mt-2 text-xs text-gray-500 flex items-start gap-2 bg-blue-50 p-2 rounded-lg text-blue-700">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{currentEventMeta.hint}</span>
          </div>

          {success && (
            <div className="mt-2 text-xs text-emerald-600 font-medium flex items-center gap-1">
              <Check className="w-3 h-3" /> {success}
            </div>
          )}
        </div>
      </div>

      {/* Editor Principal */}
      <div className="rounded-2xl border bg-white/80 backdrop-blur p-5 shadow-sm space-y-4">
        <div className="flex justify-between items-center">
            <h2 className="font-semibold">Editor de Mensaje / Prompt</h2>
            {idEditing && (
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                    Editando plantilla existente
                </span>
            )}
        </div>

        <input
          className="border rounded-xl px-3 py-2 w-full text-sm"
          placeholder="Nombre interno (opcional, ej: Cerebro Ventas)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div>
          <label className="text-xs text-gray-500 font-medium">Variables dinámicas (Click para insertar)</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {VARIABLE_HINTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="text-xs border border-dashed border-gray-300 rounded-md px-2 py-1 hover:bg-gray-100 hover:border-gray-400 transition bg-gray-50"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>

        <textarea
          ref={bodyRef}
          className="border rounded-2xl w-full min-h-[180px] p-4 text-sm leading-relaxed focus:ring-2 focus:ring-violet-500/20 outline-none transition font-mono"
          placeholder="Escribe el mensaje o las instrucciones del sistema aquí..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="flex items-center justify-between pt-2">
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>Activar plantilla</span>
          </label>

          <div className="flex gap-2">
            <button
              onClick={() => doPreview()}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50 text-sm font-medium transition"
            >
              <Eye className="w-4 h-4" />
              Ver Preview
            </button>
            <button
              onClick={save}
              className="inline-flex items-center gap-2 rounded-xl bg-gray-900 text-white px-5 py-2 text-sm font-medium hover:bg-black transition shadow-sm"
            >
              <Save className="w-4 h-4" />
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>

      {/* Preview Box */}
      {preview && (
        <div className="rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm animate-in fade-in slide-in-from-top-2">
            <h3 className="font-semibold mb-3 text-sm">Vista Previa</h3>
            <div className="bg-[#DCF8C6] rounded-lg p-3 text-sm shadow-sm max-w-[80%] text-gray-800 relative whitespace-pre-wrap leading-snug font-sans">
                  {preview}
                  <div className="text-[10px] text-gray-500 text-right mt-1">10:30 AM</div>
            </div>
        </div>
      )}

      {/* Listado */}
      <div className="rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Mis Plantillas</h2>
          <span className="text-xs text-gray-500">
            {loading ? "Cargando..." : `${rows.length} guardadas`}
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 font-medium">
              <tr>
                <th className="text-left p-3">Evento</th>
                <th className="text-left p-3">Contenido</th>
                <th className="text-left p-3 w-24">Estado</th>
                <th className="text-right p-3 w-24">Editar</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500">
                    No tienes plantillas configuradas. ¡Crea una arriba!
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60 transition group">
                  <td className="p-3 font-medium text-gray-900">
                    {EVENT_OPTS.find((o) => o.value === r.event)?.label || r.event}
                    {r.name && <div className="text-xs text-gray-500 font-normal">{r.name}</div>}
                  </td>
                  <td className="p-3 text-gray-600 max-w-md truncate" title={r.body}>
                    {r.body}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(r)}
                      className={`text-xs px-2 py-1 rounded-full border transition ${
                        r.active
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}
                    >
                      {r.active ? "Activo" : "Inactivo"}
                    </button>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => startEdit(r)}
                      className="text-xs font-medium text-violet-600 hover:text-violet-800 hover:underline px-2 py-1"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
