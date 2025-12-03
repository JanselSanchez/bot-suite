// src/app/connect/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { useParams } from "next/navigation"; // 👈 Para leer el ID del link
import { createClient } from "@supabase/supabase-js";

// Cliente Supabase Anon (Público)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type SessionStatus = "disconnected" | "qrcode" | "connecting" | "connected" | "error";

export default function PublicConnectPage() {
  // 1. Obtenemos el ID del negocio desde la URL
  const params = useParams();
  const tenantId = params?.id as string;

  const [status, setStatus] = useState<SessionStatus>("disconnected");
  const [qr, setQr] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState<string>("");
  const [loadingAction, setLoadingAction] = useState(false);

  // URL API interna
  const API_URL = "/api/wa/session";

  // 2. Cargar Nombre del Negocio (Para que sepan que es el suyo)
  useEffect(() => {
    if (!tenantId) return;
    async function fetchName() {
      const { data } = await supabase
        .from("tenants")
        .select("name")
        .eq("id", tenantId)
        .single();
      if (data) setBusinessName(data.name);
    }
    fetchName();
  }, [tenantId]);

  // 3. Escuchar Estado en Tiempo Real
  useEffect(() => {
    if (!tenantId) return;

    // Carga inicial
    const fetchInitial = async () => {
      const { data } = await supabase
        .from("whatsapp_sessions")
        .select("status, qr_data, phone_number")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (data) {
        setStatus(data.status as SessionStatus);
        setQr(data.qr_data);
        setPhone(data.phone_number);
      }
    };
    fetchInitial();

    // Suscripción Realtime
    const channel = supabase
      .channel(`public-wa-${tenantId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "whatsapp_sessions", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const newData = payload.new;
          if (newData) {
            setStatus(newData.status as SessionStatus);
            setQr(newData.qr_data);
            setPhone(newData.phone_number);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  // 4. Acción para generar QR
  async function handleConnect() {
    setLoadingAction(true);
    setQr(null); 
    try {
      await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, action: "connect" }),
      });
    } catch (e) {
      console.error(e);
    } finally {
      // Quitamos loading rápido para que esperen el QR
      setTimeout(() => setLoadingAction(false), 3000);
    }
  }

  if (!tenantId) return <div className="p-10 text-center">Enlace inválido</div>;

  const isConnected = status === "connected";
  const showQr = status === "qrcode" && qr;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center">
        
        {/* LOGO O ICONO */}
        <div className="w-16 h-16 bg-violet-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-violet-500/20">
           <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
           </svg>
        </div>

        <h1 className="text-2xl font-bold mb-2">Conectar Asistente</h1>
        <p className="text-slate-400 mb-6">
          Negocio: <span className="text-white font-medium">{businessName || "Cargando..."}</span>
        </p>

        {/* --- ESTADOS --- */}

        {/* 1. CONECTADO */}
        {isConnected && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 animate-in zoom-in">
            <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h3 className="text-emerald-400 font-bold text-lg">¡Sistema Activo!</h3>
            <p className="text-slate-400 text-sm mt-2">
              El número <span className="text-emerald-300 font-mono">{phone}</span> está conectado.
            </p>
            <p className="text-xs text-slate-500 mt-4">Ya puedes cerrar esta pestaña.</p>
          </div>
        )}

        {/* 2. BOTÓN INICIAL (DESCONECTADO) */}
        {!isConnected && !showQr && !loadingAction && (
          <div>
            <p className="text-slate-300 text-sm mb-6">
              Para activar la Inteligencia Artificial en este número, necesitamos vincularlo una única vez.
            </p>
            <button
              onClick={handleConnect}
              className="w-full py-4 bg-white text-slate-900 rounded-xl font-bold text-lg hover:bg-slate-200 transition shadow-lg active:scale-95"
            >
              Generar Código QR
            </button>
          </div>
        )}

        {/* 3. CARGANDO */}
        {loadingAction && !showQr && !isConnected && (
          <div className="py-10">
            <div className="animate-spin w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-400">Iniciando servidor seguro...</p>
          </div>
        )}

        {/* 4. MOSTRANDO QR */}
        {showQr && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-4 rounded-2xl inline-block shadow-xl">
              <QRCode
                value={qr || ""}
                size={240}
                bgColor="#FFFFFF"
                fgColor="#000000"
                level="M"
              />
            </div>
            <ol className="text-left text-sm text-slate-400 space-y-2 bg-slate-800/50 p-4 rounded-xl">
              <li>1. Abre <strong>WhatsApp</strong> en tu celular.</li>
              <li>2. Ve a <strong>Configuración</strong> {'>'} <strong>Dispositivos Vinculados</strong>.</li>
              <li>3. Dale a <strong>Vincular Dispositivo</strong>.</li>
              <li>4. Escanea el código de arriba.</li>
            </ol>
          </div>
        )}

      </div>
    </div>
  );
}