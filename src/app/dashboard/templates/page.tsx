// app/(dashboard)/templates/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useActiveTenant } from "@/app/providers/active-tenant";
import { RefreshCcw, Wand2, Save, Eye, Copy, Check, Info } from "lucide-react";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Canal fijo (solo WhatsApp)
const DEFAULT_CHANNEL = "whatsapp" as const;

// Eventos “modo empleado”
type EventKey =
  | "booking_confirmed"
  | "booking_rescheduled"
  | "booking_cancelled"
  | "reminder"
  | "payment_required";

const EVENT_OPTS: ReadonlyArray<{
  value: EventKey;
  label: string;
  hint: string;
}> = [
  { value: "booking_confirmed",   label: "Cita CONFIRMADA",   hint: "Se envía cuando la cita queda confirmada." },
  { value: "booking_rescheduled", label: "Cita REPROGRAMADA", hint: "Se envía cuando cambias fecha/hora de una cita." },
  { value: "booking_cancelled",   label: "Cita CANCELADA",    hint: "Se envía cuando se cancela una cita." },
  { value: "reminder",            label: "Recordatorio",      hint: "Se envía horas antes de la cita (automático)." },
  { value: "payment_required",    label: "Pago pendiente",    hint: "Se envía para cobrar antes o después del servicio." },
];

const VERTICALS = ["general", "restaurante", "salon", "peluqueria", "clinica"] as const;
type Vertical = typeof VERTICALS[number];

const PRESETS: Record<Vertical, Partial<Record<EventKey, string>>> = {
  general: {
    booking_confirmed:
      "Hola {{customer_name}}, tu cita del {{date}} a las {{time}} con {{resource_name}} fue confirmada. Si deseas pagar antes, usa este enlace: {{payment_link}}.",
    reminder:
      "Recordatorio: {{date}} {{time}} con {{resource_name}}. Si no podrás asistir, reprograma a tiempo.",
  },
  restaurante: {
    booking_confirmed:
      "¡Reserva confirmada! {{customer_name}}, te esperamos el {{date}} a las {{time}}. Ver ubicación y menú: {{payment_link}}",
    reminder:
      "Nos vemos hoy a las {{time}} 🍽️. Si cambias de plan, avísanos con tiempo.",
  },
  salon: {
    booking_confirmed:
      "¡Cita lista! {{customer_name}}, te esperamos el {{date}} a las {{time}} con {{resource_name}} ✨",
    reminder:
      "Beauty reminder: {{date}} {{time}} con {{resource_name}}. ¿Reprogramar? {{payment_link}}",
  },
  peluqueria: {
    booking_confirmed:
      "Barbería: cita confirmada para {{customer_name}} el {{date}} a las {{time}} con {{resource_name}} 💈",
  },
  clinica: {
    booking_confirmed:
      "Confirmación: consulta el {{date}} a las {{time}} con Dr(a). {{resource_name}}. Llegar 10 min antes.",
    reminder:
      "Recordatorio médico: {{date}} {{time}} con Dr(a). {{resource_name}}. Indicaciones: {{payment_link}}",
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

  const [vertical, setVertical] = useState<Vertical>("general");
  const [event, setEvent] = useState<EventKey>("booking_confirmed");

  const [idEditing, setIdEditing] = useState<string | null>(null);
  const [name, setName] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [active, setActive] = useState<boolean>(true);
  const [preview, setPreview] = useState<string>("");

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!loadingTenant) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, loadingTenant]);

  // 🔧 Resuelve tenant en caliente (arregla el botón Refrescar)
  async function resolveTenantId(): Promise<string | null> {
    if (tenantId) return tenantId;
    const { data: auth } = await sb.auth.getUser();
    const user = auth?.user;
    if (!user) return null;
    const { data: tu } = await sb
      .from("tenant_users")
      .select("tenant_id")
      .eq("user_id", user.id)
      .order("role", { ascending: true })
      .limit(1)
      .maybeSingle();
    return tu?.tenant_id ?? null;
  }

  async function load() {
    setLoading(true);
    const tId = await resolveTenantId();
    if (!tId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error } = await sb
      .from("message_templates")
      .select("id, tenant_id, channel, event, name, body, active, created_at")
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
      payment_link: "https://tudominio.com/pagar",
    }),
    []
  );

  function applyPreset() {
    const preset = PRESETS[vertical]?.[event];
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
    const tId = await resolveTenantId();
    if (!tId) return;

    const payload = {
      id: idEditing ?? undefined,
      tenant_id: tId,
      channel: DEFAULT_CHANNEL,
      event,
      name: name || null,
      body,
      active,
    };

    const { data, error } = await sb
      .from("message_templates")
      .upsert(payload as any, { onConflict: "tenant_id,channel,event" })
      .select("id")
      .single();

    if (error) {
      alert("No se pudo guardar la plantilla.");
      return;
    }
    setIdEditing(data?.id ?? null);
    await load();
  }

  async function toggleActive(row: TemplateRow) {
    const { error } = await sb
      .from("message_templates")
      .update({ active: !row.active })
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id);
    if (!error) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, active: !r.active } : r)));
    }
  }

  function startEdit(row: TemplateRow) {
    setIdEditing(row.id);
    setName(row.name ?? "");
    setBody(row.body);
    setActive(row.active);
    const ev = EVENT_OPTS.find((e) => e.value === (row.event as EventKey))?.value;
    if (ev) setEvent(ev);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const currentEventMeta = EVENT_OPTS.find((o) => o.value === event)!;
  const labelFromValue = (val: string) =>
    EVENT_OPTS.find((o) => o.value === (val as EventKey))?.label ?? val;

  return (
    <div className="p-6 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plantillas</h1>
          <p className="text-sm text-gray-500">
            Define mensajes por <b>evento</b> (canal fijo: WhatsApp).
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 border hover:bg-gray-50 transition disabled:opacity-60"
          title="Refrescar"
        >
          <RefreshCcw className="w-4 h-4" />
          Refrescar
        </button>
      </div>

      {/* Tipo de negocio + Evento */}
      <div className="rounded-2xl border bg-white/60 backdrop-blur p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-semibold">Tipo de negocio (texto sugerido)</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {VERTICALS.map((v) => (
              <button
                key={v}
                onClick={() => setVertical(v)}
                className={[
                  "px-3 py-1.5 rounded-full border text-sm transition",
                  vertical === v ? "bg-black text-white border-black" : "hover:bg-gray-50",
                ].join(" ")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-700">Evento</label>
          <select
            className="mt-1 border rounded-xl px-3 py-2 w-full"
            value={event}
            onChange={(e) => setEvent(e.target.value as EventKey)}
          >
            {EVENT_OPTS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="mt-2 text-xs text-gray-500 flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5" />
            <span>{currentEventMeta.hint}</span>
          </div>

          <div className="mt-3">
            <button
              onClick={applyPreset}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50"
              title="Pegar redacción sugerida según tipo de negocio + evento"
            >
              <Wand2 className="w-4 h-4" />
              Aplicar sugerencia
            </button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm space-y-3">
        <h2 className="font-semibold">Nueva / Editar</h2>

        <input
          className="border rounded-xl px-3 py-2 w-full"
          placeholder="Nombre interno (opcional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div>
          <label className="text-xs text-gray-500">Variables rápidas</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {VARIABLE_HINTS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVariable(v)}
                className="text-xs border rounded-full px-2 py-1 hover:bg-gray-50"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>

        <textarea
          ref={bodyRef}
          className="border rounded-2xl w-full min-h-[160px] p-3"
          placeholder="Escribe el mensaje. Ej: Hola {{customer_name}}..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <div className="flex items-center justify-between">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activo
          </label>

          <div className="flex gap-2">
            <button
              onClick={save}
              className="inline-flex items-center gap-2 rounded-xl bg-black text-white px-4 py-2"
            >
              <Save className="w-4 h-4" />
              Guardar
            </button>
            <button
              onClick={() => doPreview()}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50"
            >
              <Eye className="w-4 h-4" />
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm">
        <h3 className="font-semibold mb-3">Preview</h3>
        {preview ? (
          <>
            <div className="bg-[#e7ffd6] rounded-2xl p-4 text-sm shadow-inner max-w-[680px]">
              <div className="whitespace-pre-wrap leading-6">{preview}</div>
            </div>
            <div className="mt-3">
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(preview);
                  } catch {}
                }}
                className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 hover:bg-gray-50"
              >
                <Copy className="w-4 h-4" /> Copiar
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500">Genera un preview para ver el resultado.</p>
        )}
      </div>

      {/* Listado */}
      <div className="rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Plantillas guardadas</h2>
          <span className="text-xs text-gray-500">
            {loading ? "Cargando…" : `${rows.length} resultado(s)`}
          </span>
        </div>

        <div className="overflow-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left p-3">Evento</th>
                <th className="text-left p-3">Nombre</th>
                <th className="text-left p-3">Activo</th>
                <th className="text-left p-3">Body</th>
                <th className="text-left p-3 w-28">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-gray-500">
                    No hay plantillas aún. Crea la primera arriba.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-gray-50/60">
                  <td className="p-3">
                    {EVENT_OPTS.find((o) => o.value === (r.event as EventKey))?.label ?? r.event}
                  </td>
                  <td className="p-3">{r.name ?? "—"}</td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(r)}
                      className={[
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs",
                        r.active ? "bg-emerald-600 text-white border-emerald-600" : "bg-white",
                      ].join(" ")}
                      title="Activar/Desactivar"
                    >
                      {r.active ? <Check className="w-3.5 h-3.5" /> : null}
                      {r.active ? "Activo" : "—"}
                    </button>
                  </td>
                  <td className="p-3">
                    <div className="text-gray-700">
                      {r.body.length > 140 ? `${r.body.slice(0, 140)}…` : r.body}
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        onClick={() => startEdit(r)}
                        className="text-xs rounded-xl border px-2.5 py-1.5 hover:bg-gray-50"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setPreview(renderTemplate(r.body || "", sampleData))}
                        className="text-xs rounded-xl border px-2.5 py-1.5 hover:bg-gray-50"
                      >
                        Ver
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={5} className="p-6">
                    <div className="animate-pulse h-4 bg-gray-200 rounded w-1/3 mb-3" />
                    <div className="animate-pulse h-4 bg-gray-200 rounded w-2/3" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Tip: crea una plantilla por evento. Para mensajes iniciados fuera de la ventana de 24 h
          de WhatsApp, usa plantillas aprobadas en tu proveedor.
        </p>
      </div>
    </div>
  );
}
