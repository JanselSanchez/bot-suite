"use client";
import { useEffect, useState } from "react";

const WEEK = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

function hmToMin(hm: string) {
  const [h,m] = hm.split(":").map(n=>parseInt(n,10));
  return h*60 + m;
}
function minToHM(min: number) {
  const h = Math.floor(min/60), m = min%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export default function BusinessHoursEditor({ tenantId, resourceId }:{
  tenantId: string; resourceId: string|null;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    const params = new URLSearchParams({ tenantId });
    if (resourceId) params.set("resourceId", resourceId);
    const res = await fetch(`/api/admin/business-hours?${params.toString()}`);
    const { data } = await res.json();
    setRows(data ?? []);
  }

  useEffect(()=>{ void load(); }, [tenantId, resourceId]);

  async function saveRow(r: any) {
    setLoading(true);
    try {
      if (r.id) {
        await fetch("/api/admin/business-hours", { method:"PUT", body: JSON.stringify(r) });
      } else {
        await fetch("/api/admin/business-hours", { method:"POST", body: JSON.stringify({
          tenant_id: tenantId,
          resource_id: resourceId,
          weekday: r.weekday,
          start_min: hmToMin(r.start_hm),
          end_min: hmToMin(r.end_hm),
          is_open: r.is_open ?? true,
        })});
      }
      await load();
    } finally { setLoading(false); }
  }

  async function remove(id: string) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ id });
      await fetch(`/api/admin/business-hours?${params.toString()}`, { method:"DELETE" });
      await load();
    } finally { setLoading(false); }
  }

  // Normaliza 7 filas
  const normalized = Array.from({length:7}).map((_,i)=>{
    const found = rows.find((r:any)=>r.weekday===i);
    return found ? {
      id: found.id,
      weekday: i,
      start_hm: minToHM(found.start_min),
      end_hm: minToHM(found.end_min),
      is_open: found.is_open,
    } : { id:null, weekday:i, start_hm:"09:00", end_hm:"18:00", is_open:true };
  });

  return (
    <div className="rounded border p-4 space-y-3">
      <h2 className="font-medium">Horarios por día</h2>
      <div className="grid gap-2" style={{gridTemplateColumns:"100px 130px 130px 110px 120px"}}>
        <div className="text-sm text-gray-500">Día</div>
        <div className="text-sm text-gray-500">Desde</div>
        <div className="text-sm text-gray-500">Hasta</div>
        <div className="text-sm text-gray-500">Abierto</div>
        <div className="text-sm text-gray-500">Acciones</div>

        {normalized.map((r)=>(
          <div className="contents" key={r.weekday}>
            <div className="py-1">{WEEK[r.weekday]}</div>
            <input className="border rounded px-2 py-1" value={r.start_hm}
              onChange={e=>{ r.start_hm=e.target.value; setRows([...rows]); }} />
            <input className="border rounded px-2 py-1" value={r.end_hm}
              onChange={e=>{ r.end_hm=e.target.value; setRows([...rows]); }} />
            <input type="checkbox" checked={r.is_open}
              onChange={e=>{ r.is_open=e.target.checked; setRows([...rows]); }} />
            <div className="flex gap-2">
              <button className="border rounded px-2 py-1" disabled={loading}
                onClick={()=>saveRow(r)}>{r.id ? "Actualizar" : "Guardar"}</button>
              {r.id && (
                <button className="border rounded px-2 py-1" disabled={loading}
                  onClick={()=>remove(r.id)}>Eliminar</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
