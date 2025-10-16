// imports nuevos arriba:
import FiltersBar from "./FiltersBar";
import CreateBookingDialog from "./CreateBookingDialog";
import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// dentro del componente principal de page.tsx (NO borres nada):
const [tenantId, setTenantId] = useState<string>("");
useEffect(()=>{ (async()=>{
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: tu } = await sb.from("tenant_users").select("tenant_id").eq("user_id", user.id).order("role",{ascending:true}).limit(1).maybeSingle();
  if (tu?.tenant_id) setTenantId(tu.tenant_id);
})(); }, []);

const [filters, setFilters] = useState<BookingFilters>({ page: 1, pageSize: 20 });
const [rows, setRows] = useState<any[]>([]);
const [total, setTotal] = useState(0);
const [loading, setLoading] = useState(false);

type BookingFilters = {
    q?: string;
    status?: string[];
    serviceId?: string;
    resourceId?: string;
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
    page?: number;
    pageSize?: number;
  };
  

async function load() {
  if (!tenantId) return;
  setLoading(true);
  try {
    const params = new URLSearchParams({ tenantId, page: String(filters.page || 1), pageSize: String(filters.pageSize || 20) });
    if (filters.q) params.set("q", filters.q);
    if (filters.status?.length) params.set("status", filters.status.join(","));
    if (filters.serviceId) params.set("serviceId", filters.serviceId);
    if (filters.resourceId) params.set("resourceId", filters.resourceId);
    if (filters.from) params.set("from", `${filters.from}T00:00:00`);
    if (filters.to) params.set("to", `${filters.to}T23:59:59`);
    const res = await fetch(`/api/admin/bookings/list?${params.toString()}`);
    const j = await res.json();
    setRows(j.data || []); setTotal(j.total || 0);
  } finally { setLoading(false); }
}
useEffect(()=>{ void load(); }, [tenantId, filters]);



// en el JSX donde quieras (arriba de la tabla):
{tenantId && (
  <div className="flex items-center justify-between mb-3">
    <FiltersBar tenantId={tenantId} onChange={(f)=>setFilters(prev=>({ ...prev, ...f, page:1 }))} />
    <CreateBookingDialog tenantId={tenantId} onCreated={()=>load()} />
  </div>
)}

// la tabla (usa la tuya; aquí un ejemplo mínimo de acciones)
<table className="w-full text-sm border">
  <thead>...</thead>
  <tbody>
    {rows.map((r:any)=>(
      <tr key={r.id} className="border-t">
        <td className="p-2">{new Date(r.starts_at).toLocaleString()}</td>
        <td className="p-2">{r.customer_name || r.customer_phone}</td>
        <td className="p-2">{r.status}</td>
        <td className="p-2">
          {/* Botones de acción: reprogramar, cancelar, no-show */}
          {/* Reprogramar: abre tu RescheduleDialog.tsx existente */}
          {/* <RescheduleDialog bookingId={r.id} tenantId={tenantId} onDone={()=>load()} /> */}
          <button className="border rounded px-2 py-1 mr-2" onClick={async ()=>{
            const reason = prompt("Motivo de cancelación (opcional)") || undefined;
            const res = await fetch("/api/admin/bookings/cancel", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tenantId, bookingId: r.id, reason }) });
            if (!res.ok) alert("Error al cancelar"); else load();
          }}>Cancelar</button>
          <button className="border rounded px-2 py-1" onClick={async ()=>{
            const res = await fetch("/api/admin/bookings/no-show", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ tenantId, bookingId: r.id }) });
            if (!res.ok) alert("Error marcando no-show"); else load();
          }}>No-show</button>
        </td>
      </tr>
    ))}
  </tbody>
</table>

{/* paginación simple */}
<div className="mt-3 flex items-center gap-2">
  <button className="border rounded px-2 py-1" disabled={(filters.page||1) <= 1} onClick={()=>setFilters(f=>({ ...f, page: (f.page||1)-1 }))}>Anterior</button>
  <span>Página {filters.page||1}</span>
  <button className="border rounded px-2 py-1" disabled={(filters.page||1) >= Math.ceil(total/(filters.pageSize||20))} onClick={()=>setFilters(f=>({ ...f, page: (f.page||1)+1 }))}>Siguiente</button>
  <span className="text-gray-500 ml-2">{total} resultados</span>
</div>
