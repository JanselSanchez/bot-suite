"use client";
import { useEffect, useState } from "react";

function isoLocal(d: Date) {
  const pad = (n:number)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ExceptionsTable({ tenantId, resourceId }:{
  tenantId: string; resourceId: string|null;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<any>({
    starts_at: isoLocal(new Date()),
    ends_at: isoLocal(new Date(Date.now()+2*60*60*1000)),
    is_closed: true,
    note: ""
  });
  const [loading, setLoading] = useState(false);

  async function load() {
    const params = new URLSearchParams({ tenantId });
    if (resourceId) params.set("resourceId", resourceId);
    const { data } = await (await fetch(`/api/admin/exceptions?${params.toString()}`)).json();
    setRows(data ?? []);
  }
  useEffect(()=>{ void load(); }, [tenantId, resourceId]);

  async function add() {
    setLoading(true);
    try {
      const payload = {
        tenant_id: tenantId,
        resource_id: resourceId,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        is_closed: !!form.is_closed,
        note: form.note || null
      };
      await fetch("/api/admin/exceptions", { method:"POST", body: JSON.stringify(payload) });
      setForm({...form, note:""});
      await load();
    } finally { setLoading(false); }
  }

  async function del(id:string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ id });
      await fetch(`/api/admin/exceptions?${params.toString()}`, { method:"DELETE" });
      await load();
    } finally { setLoading(false); }
  }

  return (
    <div className="rounded border p-4 space-y-3">
      <h2 className="font-medium">Excepciones (cierres/feriados/vacaciones)</h2>

      <div className="grid gap-2" style={{gridTemplateColumns:"220px 220px 120px 1fr 120px"}}>
        <input type="datetime-local" className="border rounded px-2 py-1"
          value={form.starts_at} onChange={e=>setForm({...form, starts_at:e.target.value})} />
        <input type="datetime-local" className="border rounded px-2 py-1"
          value={form.ends_at} onChange={e=>setForm({...form, ends_at:e.target.value})} />
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={!!form.is_closed}
            onChange={e=>setForm({...form, is_closed:e.target.checked})} /> Cierre
        </label>
        <input className="border rounded px-2 py-1" placeholder="Nota"
          value={form.note} onChange={e=>setForm({...form, note:e.target.value})} />
        <button className="border rounded px-3 py-1" disabled={loading} onClick={add}>Agregar</button>
      </div>

      <table className="w-full text-sm border">
        <thead><tr className="bg-gray-50">
          <th className="p-2 text-left">Inicio</th>
          <th className="p-2 text-left">Fin</th>
          <th className="p-2 text-left">Tipo</th>
          <th className="p-2 text-left">Nota</th>
          <th className="p-2 text-left">Acciones</th>
        </tr></thead>
        <tbody>
          {(rows||[]).map((r:any)=>(
            <tr key={r.id} className="border-t">
              <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
              <td className="p-2">{new Date(r.ends_at).toLocaleString()}</td>
              <td className="p-2">{r.is_closed ? "Cierre" : "Excepción abierta"}</td>
              <td className="p-2 whitespace-pre-wrap">{r.note || ""}</td>
              <td className="p-2">
                <button className="border rounded px-2 py-1" disabled={loading} onClick={()=>del(r.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
