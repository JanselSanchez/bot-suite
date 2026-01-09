// src/app/dashboard/tenants/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ShieldCheck, Phone, Store, FileText, Mail } from "lucide-react"; // 👈 Agregamos Mail
import { Button } from "@/componentes/ui/button";
import { VERTICALS } from "@/app/lib/constants";

const DEFAULT_TZ = "America/Santo_Domingo";

function normalizePhone(raw: string) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("whatsapp:")) return s;
  if (s.startsWith("+")) return `whatsapp:${s}`;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `whatsapp:${digits}`;
  if (/^\d{10}$/.test(digits)) return `whatsapp:+1${digits}`;
  return `whatsapp:${digits}`;
}

export default function NewTenantPage() {
  const router = useRouter();
  
  // Estados del formulario
  const [name, setName] = useState("");
  const [vertical, setVertical] = useState("general");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState(""); // 👈 Nuevo estado para el Email
  const [timezone, setTimezone] = useState(DEFAULT_TZ);
  const [loading, setLoading] = useState(false);

  const disabled = loading || !name.trim();

  async function handleCreate() {
    if (!name.trim()) return;

    setLoading(true);
    try {
      const payload: any = {
        name: name.trim(),
        vertical,
        description: description.trim() || null,
        notification_email: email.trim() || null, // 👈 Enviamos el email al backend
        timezone: timezone || DEFAULT_TZ,
      };
      
      const normalized = normalizePhone(phone);
      if (normalized) payload.phone = normalized;

      const r = await fetch("/api/admin/new-business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (r.status === 401) {
        alert("Inicia sesión");
        return;
      }

      const j = await r.json();
      if (!j.ok) {
        alert(j.error || "No se pudo crear el negocio");
        return;
      }

      router.push("/dashboard");
    } catch (e) {
      console.error(e);
      alert("Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative">
      {/* Fondo decorativo */}
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
                Define la identidad de tu negocio para configurar <span className="font-medium text-gray-700">la IA y el Bot</span>.
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 md:p-8 space-y-6">
            
            {/* 1. Nombre */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Nombre del Negocio</label>
              <input
                className="mt-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                placeholder="Ej. Barbería Luis"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* 2. Tipo de Negocio (Vertical) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Tipo de Negocio</label>
              <p className="text-xs text-gray-400 mb-2">Esto ayuda a la IA a saber cómo hablar (ej. citas vs reservas).</p>
              <div className="flex items-center gap-2">
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-gray-200 bg-white shadow-sm shrink-0">
                   <Store className="h-5 w-5 text-gray-500" />
                </div>
                <select
                  className="flex-1 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 cursor-pointer"
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value)}
                >
                  {VERTICALS.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 3. Descripción (Contexto IA) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Descripción breve</label>
              <p className="text-xs text-gray-400 mb-2">Dale contexto al bot: ¿Qué servicios principales ofreces?</p>
              <div className="flex items-start gap-2">
                 <div className="grid h-11 w-11 place-items-center rounded-2xl border border-gray-200 bg-white shadow-sm shrink-0 mt-0.5">
                   <FileText className="h-5 w-5 text-gray-500" />
                </div>
                <textarea
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200 min-h-[80px] resize-none"
                  placeholder="Ej. Especialistas en cortes modernos, barbas y faciales. Ubicados en el centro."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>

            {/* 4. WhatsApp */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                WhatsApp / Teléfono <span className="text-gray-400">(opcional)</span>
              </label>
              <div className="mt-1 flex items-center gap-2">
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-gray-200 bg-white shadow-sm shrink-0">
                  <Phone className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                  placeholder="+1829XXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>

            {/* 5. Email para Notificaciones (NUEVO) */}
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Email para Notificaciones
              </label>
              <p className="text-xs text-gray-400 mb-2">Aquí te avisaremos cuando tengas una nueva cita.</p>
              <div className="flex items-center gap-2">
                <div className="grid h-11 w-11 place-items-center rounded-2xl border border-gray-200 bg-white shadow-sm shrink-0">
                  <Mail className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  type="email"
                  className="flex-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] shadow-sm outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                  placeholder="Ej. contacto@negocio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* 6. Zona Horaria */}
            <div>
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

            {/* Botón Guardar */}
            <div className="pt-4 flex items-center justify-between gap-4">
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
