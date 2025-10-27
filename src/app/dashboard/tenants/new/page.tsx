"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

import { Building2, ShieldCheck, Phone } from "lucide-react";
import { Button } from "@/componentes/ui/button";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// RD por defecto
const DEFAULT_TZ = "America/Santo_Domingo";

// normaliza a formatos que ya usas en DB (ej. "whatsapp:+1829XXXXXXX")
function normalizePhone(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  // si ya viene con "whatsapp:" lo respetamos
  if (s.toLowerCase().startsWith("whatsapp:")) return s;
  // si empieza con + lo convertimos a "whatsapp:+"
  if (s.startsWith("+")) return `whatsapp:${s}`;
  // limpia caracteres no numéricos y asume RD si faltó "+"
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  // si no puso +, pero puso 10 dígitos RD, anteponemos +1
  if (/^\d{10}$/.test(digits)) return `whatsapp:+1${digits}`;
  return `whatsapp:${digits}`;
}

export default function NewTenantPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [loading, setLoading] = useState(false);

  const disabled = loading || !name.trim();

  async function handleCreate() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) { alert("Inicia sesión"); return; }

      const payload: any = {
        name: name.trim(),
        timezone: timezone || "America/Santo_Domingo",
        // status: "activa",   // ❌ quítalo
        // O bien:
        // status: "active",   // ✅ si quieres fijarlo explícito
      };
      const normalized = normalizePhone(phone);
      if (normalized) payload.phone = normalized;
      
      const { data: tenant, error } = await sb
        .from("tenants")
        .insert([payload])
        .select()
        .single();

      if (error || !tenant) {
        console.error("insert tenants error:", error);
        alert(error?.message || "No se pudo crear el negocio");
        return;
      }

      // Si existe tenant_users, intenta asociar al propietario (ignorable si no existe)
      try {
        await sb.from("tenant_users").insert([{
          tenant_id: tenant.id,
          user_id: user.id,
          role: "owner",
        }]);
      } catch (e) {
        console.warn("tenant_users insert skipped:", (e as any)?.message);
      }

      router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      {/* halo violeta suave */}
      <div className="pointer-events-none absolute inset-0 mx-auto max-w-5xl blur-3xl" aria-hidden>
        <div className="h-64 w-full rounded-full bg-gradient-to-r from-fuchsia-400/15 via-violet-400/15 to-indigo-400/15" />
      </div>

      <div className="mx-auto mt-14 max-w-3xl px-4">
        <div className="rounded-3xl border border-white/60 bg-white/80 shadow-xl backdrop-blur-xl">
          {/* Header */}
          <div className="flex items-start gap-4 border-b border-gray-100/70 p-6 md:p-8">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-md">
              <Building2 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Crear negocio</h1>
              <p className="mt-1 text-sm text-gray-500">
                Este será tu espacio de trabajo para <span className="font-medium text-gray-700">citas, plantillas y bot</span>.
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 md:p-8">
            <label className="block text-sm font-medium text-gray-700">Nombre</label>
            <input
              className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              placeholder="Ej. Barbería Luis"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700">
                WhatsApp / Teléfono <span className="text-gray-400">(opcional)</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <Phone className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                  placeholder="+1829XXXXXXX o 829-XXX-XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Se guardará como <code>whatsapp:+1XXXXXXXXXX</code> si es RD.
              </p>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-medium text-gray-700">Zona horaria</label>
              <select
                className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                <option value="America/Santo_Domingo">America/Santo_Domingo</option>
                <option value="America/New_York">America/New_York</option>
                <option value="America/Mexico_City">America/Mexico_City</option>
                <option value="UTC">UTC</option>
              </select>
            </div>

            {/* CTA */}
            <div className="mt-8 flex items-center justify-between gap-4">
              <div className="hidden items-center gap-2 text-sm text-gray-500 md:flex">
                <ShieldCheck className="h-4 w-4 text-violet-500" />
                <span>Podrás cambiar esto luego en Configuración.</span>
              </div>

              <Button
                className="ml-auto rounded-2xl px-6 py-2.5 font-medium shadow-md transition hover:shadow-lg active:scale-[.98]"
                onClick={handleCreate}
                disabled={disabled}
              >
                {loading ? "Creando..." : "Crear negocio"}
              </Button>
            </div>
          </div>
        </div>

        <p className="mx-auto mt-6 text-center text-xs text-gray-400">
          © 2025 PymeBOT — plataforma de bots para negocios con estilo 💜
        </p>
      </div>
    </div>
  );
}
