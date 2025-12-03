// src/app/connect/[tenantId]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import QRCode from "react-qr-code";
import { Check, LogOut } from "lucide-react";

type SessionStatus =
  | "disconnected"
  | "qrcode"
  | "connecting"
  | "connected"
  | "error";

interface SessionDTO {
  id: string;
  status: SessionStatus;
  qr_svg?: string | null;
  qr_data?: string | null;
  phone_number?: string | null;
  last_connected_at?: string | null;
}

type SessionResponse = {
  ok: boolean;
  session: SessionDTO | null;
  error?: string;
};

export default function PublicConnectWhatsAppPage() {
  // 👇 leemos el tenantId directamente de la URL (/connect/[tenantId])
  const params = useParams();
  const tenantId = (params?.tenantId as string) || "";

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // helper: estado derivado
  const rawStatus: SessionStatus = session?.status ?? "disconnected";
  const hasQr = !!session?.qr_data;
  const isConnected = rawStatus === "connected" && !hasQr;
  const connectedPhone = session?.phone_number || null;
  const connectedAt = session?.last_connected_at || null;

  // --- llamadas a API ---

  async function fetchSession() {
    if (!tenantId) return;
    try {
      const res = await fetch(
        `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as SessionResponse;
      if (!json.ok) {
        throw new Error(json.error || "Error al cargar sesión");
      }
      setSession(json.session);
      setError(null);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err: any) {
      console.error("[PublicConnect] fetchSession error:", err);
      setError(err?.message || "No se pudo cargar la sesión");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  async function ensureConnectedSession() {
    if (!tenantId) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/wa/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, action: "connect" }),
      });
      const json = (await res.json()) as SessionResponse;
      if (!json.ok) {
        throw new Error(json.error || "No se pudo iniciar la sesión");
      }
      await fetchSession();
    } catch (err: any) {
      console.error("[PublicConnect] ensureConnectedSession error:", err);
      setError(err?.message || "No se pudo iniciar la sesión");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!tenantId) return;
    if (!confirm("¿Seguro que quieres desconectar este WhatsApp?")) return;
    try {
      await fetch("/api/wa/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, action: "disconnect" }),
      });
      setSession(null);
      await fetchSession();
    } catch (err) {
      console.error("[PublicConnect] handleDisconnect error:", err);
    }
  }

  // --- efecto principal: iniciar sesión + polling ---
  useEffect(() => {
    if (!tenantId) {
      setError("El enlace no tiene un negocio válido.");
      setLoading(false);
      return;
    }

    let interval: NodeJS.Timeout | null = null;

    (async () => {
      setLoading(true);
      setError(null);
      await ensureConnectedSession();
      // Poll cada 4s para actualizar QR / estado
      interval = setInterval(fetchSession, 4000);
    })();

    return () => {
      if (interval) clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-6 shadow-2xl shadow-black/50 text-center">
          <div className="mb-4">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600/20 border border-violet-500/40">
              <span className="text-2xl">📱</span>
            </div>
            <h1 className="text-xl font-semibold mb-1">Conectar Asistente</h1>
            <p className="text-xs text-slate-400">
              Negocio ID:{" "}
              <span className="font-mono">
                {tenantId || "—"}
              </span>
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-3">
              {error}
            </p>
          )}

          {/* 1) Loading inicial */}
          {loading && !session && (
            <div className="py-6">
              <div className="mx-auto mb-3 h-8 w-8 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
              <p className="text-sm text-slate-300">
                Iniciando servidor seguro...
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                No cierres esta ventana mientras se genera el código QR.
              </p>
            </div>
          )}

          {/* 2) Mostrar QR */}
          {!loading && !isConnected && hasQr && (
            <div className="flex flex-col items-center">
              <p className="text-sm text-slate-200 mb-3">
                Abre <span className="font-semibold">WhatsApp</span> en tu
                celular &gt;{" "}
                <span className="font-semibold">Dispositivos vinculados</span>{" "}
                &gt; <span className="font-semibold">Vincular dispositivo</span>
              </p>

              <div className="bg-white p-3 rounded-2xl inline-flex">
                <QRCode
                  value={session?.qr_data || ""}
                  size={220}
                  bgColor="#FFFFFF"
                  fgColor="#000000"
                  level="M"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                  viewBox="0 0 256 256"
                />
              </div>

              <p className="text-[11px] text-slate-500 mt-3">
                El código puede cambiar cada pocos segundos. Mantén la cámara
                apuntando al QR.
              </p>
            </div>
          )}

          {/* 3) Ya conectado */}
          {!loading && isConnected && (
            <div className="flex flex-col items-center py-4">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-400/60">
                <Check className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-base font-semibold text-emerald-400 mb-1">
                ¡WhatsApp conectado!
              </p>
              <p className="text-xs text-slate-400 mb-3">
                Número vinculado:{" "}
                <span className="font-mono text-slate-100">
                  {connectedPhone || "desconocido"}
                </span>
              </p>
              {connectedAt && (
                <p className="text-[11px] text-slate-500 mb-4">
                  Desde: {new Date(connectedAt).toLocaleString()}
                </p>
              )}

              <button
                onClick={handleDisconnect}
                className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
              >
                <LogOut className="w-3 h-3" />
                Desconectar este dispositivo
              </button>
            </div>
          )}

          {/* 4) Estado raro sin QR */}
          {!loading && !hasQr && !isConnected && !error && (
            <div className="py-4">
              <p className="text-sm text-slate-300 mb-2">
                Preparando el código QR...
              </p>
              <div className="mx-auto h-6 w-6 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            </div>
          )}

          <p className="mt-6 text-[10px] text-slate-500">
            Powered by PymeBOT • Última actualización:{" "}
            {lastUpdated || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
