"use client";
import { useEffect, useState } from "react";

type Props = {
  tenantId: string;
  onChange: (f: {
    q?: string;
    status?: string[];
    serviceId?: string;
    resourceId?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) => void;
};

export default function FiltersBar({ tenantId, onChange }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string[]>([]);
  const [serviceId, setServiceId] = useState<string>("");
  const [resourceId, setResourceId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [services, setServices] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [pageSize, setPageSize] = useState(20);

  useEffect(() => {
    (async () => {
      const [svcsRes, resRes] = await Promise.all([
        fetch(`/api/admin/bookings/services?tenantId=${tenantId}`).catch(()=>null),
        fetch(`/api/admin/bookings/resources?tenantId=${tenantId}`).catch(()=>null),
      ]);
      // si no tienes esos endpoints, puedes cargar directo de Supabase en cliente o reusar APIs existentes.
      const svcs = svcsRes?.ok ? (await svcsRes.json()).data || [] : [];
      const res = resRes?.ok ? (await resRes.json()).data || [] : [];
      setServices(svcs); setResources(res);
    })();
  }, [tenantId]);

  function emit(page = 1) {
    onChange({ q, status, serviceId: serviceId || undefined, resourceId: resourceId || undefined, from: from || undefined, to: to || undefined, page, pageSize });
  }

  return (
    <div className="rounded border p-3 grid gap-2 md:grid-cols-6">
      <input className="border rounded px-2 py-1 md:col-span-2" placeholder="Buscar (tel/nombre)" value={q} onChange={e=>setQ(e.target.value)} />
      <select className="border rounded px-2 py-1" value={serviceId} onChange={e=>setServiceId(e.target.value)}>
        <option value="">Todos los servicios</option>
        {services.map((s:any)=> <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="border rounded px-2 py-1" value={resourceId} onChange={e=>setResourceId(e.target.value)}>
        <option value="">Todos los recursos</option>
        {resources.map((r:any)=> <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <input type="date" className="border rounded px-2 py-1" value={from} onChange={e=>setFrom(e.target.value)} />
      <input type="date" className="border rounded px-2 py-1" value={to} onChange={e=>setTo(e.target.value)} />

      <div className="md:col-span-6 flex gap-2 items-center">
        <label className="text-sm">Estado:</label>
        {["confirmed","rescheduled","pending","cancelled","no_show"].map(st=>(
          <label key={st} className="text-sm inline-flex items-center gap-1">
            <input type="checkbox" checked={status.includes(st)}
              onChange={e=>{
                setStatus(s=> e.target.checked ? [...s, st] : s.filter(x=>x!==st));
              }} />
            {st}
          </label>
        ))}
        <label className="text-sm ml-auto">Por página:</label>
        <select className="border rounded px-2 py-1" value={pageSize} onChange={e=>setPageSize(parseInt(e.target.value))}>
          {[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
        </select>
        <button className="border rounded px-3 py-1" onClick={()=>emit(1)}>Aplicar</button>
      </div>
    </div>
  );
}
