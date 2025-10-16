// app/(dashboard)/templates/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

const EVENTS = ["booking_confirmed","booking_rescheduled","booking_cancelled","reminder","payment_required"] as const;
const CHANNELS = ["whatsapp","sms","email"] as const;

export default function TemplatesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [tenantId, setTenantId] = useState<string>(""); // setéalo desde tu sesión
  const [filter, setFilter] = useState<{event?: string; channel?: string}>({});

  const [body, setBody] = useState("");
  const [event, setEvent] = useState<typeof EVENTS[number]>("booking_confirmed");
  const [channel, setChannel] = useState<typeof CHANNELS[number]>("whatsapp");
  const [active, setActive] = useState(true);
  const [preview, setPreview] = useState("");

  useEffect(() => { void load(); }, [tenantId, filter]);

  async function load() {
    if (!tenantId) return;
    let q = sb.from("message_templates").select("id, channel, event, body, active").eq("tenant_id", tenantId).order("event");
    if (filter.event) q = q.eq("event", filter.event);
    if (filter.channel) q = q.eq("channel", filter.channel);
    const { data } = await q;
    setRows(data || []);
  }

  async function save() {
    if (!tenantId) return;
    await sb.from("message_templates").upsert({
      tenant_id: tenantId,
      channel,
      event,
      body,
      active
    }, { onConflict: "tenant_id,channel,event" });
    setBody("");
    setActive(true);
    await load();
  }

  function renderTemplate(str: string, vars: Record<string,string>) {
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Plantillas</h1>

      <div className="flex gap-2">
        <select className="border p-2 rounded" value={filter.event ?? ""} onChange={e=>setFilter(f=>({...f, event:e.target.value||undefined}))}>
          <option value="">Todos los eventos</option>
          {EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
        </select>
        <select className="border p-2 rounded" value={filter.channel ?? ""} onChange={e=>setFilter(f=>({...f, channel:e.target.value||undefined}))}>
          <option value="">Todos los canales</option>
          {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
        </select>
        <button className="border px-3 py-2 rounded" onClick={()=>load()}>Refrescar</button>
      </div>

      <table className="w-full text-sm border">
        <thead>
          <tr className="bg-gray-50">
            <th className="p-2 text-left">Canal</th>
            <th className="p-2 text-left">Evento</th>
            <th className="p-2 text-left">Activo</th>
            <th className="p-2 text-left">Body</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.id} className="border-t">
              <td className="p-2">{r.channel}</td>
              <td className="p-2">{r.event}</td>
              <td className="p-2">{r.active ? "✅" : "—"}</td>
              <td className="p-2 whitespace-pre-wrap">{r.body}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <h2 className="font-medium">Nueva / Editar</h2>
          <div className="flex gap-2">
            <select className="border p-2 rounded" value={channel} onChange={e=>setChannel(e.target.value as any)}>
              {CHANNELS.map(ch => <option key={ch} value={ch}>{ch}</option>)}
            </select>
            <select className="border p-2 rounded" value={event} onChange={e=>setEvent(e.target.value as any)}>
              {EVENTS.map(ev => <option key={ev} value={ev}>{ev}</option>)}
            </select>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />
              Activo
            </label>
          </div>

          <textarea
            className="border w-full h-40 p-2 rounded"
            placeholder="Usa variables: {{customer_name}}, {{date}}, {{time}}, {{resource_name}}, {{payment_link}}"
            value={body}
            onChange={e=>setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="bg-black text-white px-4 py-2 rounded" onClick={save}>Guardar</button>
            <button className="border px-4 py-2 rounded" onClick={()=>{
              setPreview(renderTemplate(body || "", {
                customer_name: "Ana",
                date: "15/10/2025",
                time: "10:30 a. m.",
                resource_name: "Laura",
                payment_link: "https://tu-dominio.com/billing"
              }))
            }}>Preview</button>
          </div>
        </div>

        <div>
          <h2 className="font-medium">Preview</h2>
          <pre className="border rounded p-3 whitespace-pre-wrap">{preview}</pre>
        </div>
      </div>
    </div>
  );
}
