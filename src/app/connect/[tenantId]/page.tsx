
// src/app/connect/[tenantId]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

function safeTenantIdFromParams(p: unknown): string {
  // useParams puede ser string o string[]
  const raw =
    typeof p === "string"
      ? p
      : Array.isArray(p)
        ? (p[0] ?? "")
        : "";
  return String(raw || "").trim();
}

export default function PublicConnectWhatsAppPage() {
  // 👇 leemos el tenantId directamente de la URL (/connect/[tenantId])
  const params = useParams();
  const tenantId = useMemo(
    () => safeTenantIdFromParams((params as any)?.tenantId),
    [params]
  );

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // anti-race / abort
  const abortRef = useRef<AbortController | null>(null);
  const connectTriggeredRef = useRef(false);

  function resetAbort() {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    return abortRef.current;
  }

  function stamp() {
    try {
      return new Date().toLocaleTimeString();
    } catch {
      return "";
    }
  }

  // helper: estado derivado
  const rawStatus: SessionStatus = session?.status ?? "disconnected";
  const hasQr = !!session?.qr_data;
  const isConnected = rawStatus === "connected" && !hasQr;
  const connectedPhone = session?.phone_number || null;
  const connectedAt = session?.last_connected_at || null;

  // --- llamadas a API ---

  async function fetchSession(signal?: AbortSignal) {
    if (!tenantId) return;

    try {
      const res = await fetch(
        `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}&t=${Date.now()}`,
        { cache: "no-store", signal }
      );

      // 🔥 FIX: si middleware/auth redirige, esto NO será JSON
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          "La API no devolvió JSON (probable redirect a login / middleware). " +
            (text ? `Preview: ${text.slice(0, 120)}...` : "")
        );
      }

      const json = (await res.json()) as SessionResponse;
      if (!json.ok) throw new Error(json.error || "Error al cargar sesión");

      setSession(json.session);
      setError(null);
      setLastUpdated(stamp());
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[PublicConnect] fetchSession error:", err);
      setError(err?.message || "No se pudo cargar la sesión");
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  async function ensureConnectedSession(signal?: AbortSignal) {
    if (!tenantId) return;
    setConnecting(true);

    try {
      const res = await fetch(`/api/wa/session?t=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tenantId, action: "connect" }),
        signal,
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        const text = await res.text().catch(() => "");
        throw new Error(
          "El connect no devolvió JSON (probable redirect a login / middleware). " +
            (text ? `Preview: ${text.slice(0, 120)}...` : "")
        );
      }

      const json = (await res.json()) as SessionResponse;
      if (!json.ok) throw new Error(json.error || "No se pudo iniciar la sesión");

      // refresca una vez para intentar agarrar QR rápido
      await fetchSession(signal);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[PublicConnect] ensureConnectedSession error:", err);
      setError(err?.message || "No se pudo iniciar la sesión");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (!tenantId) return;
    if (!confirm("¿Seguro que quieres desconectar este WhatsApp?")) return;

    const controller = resetAbort();

    try {
      const res = await fetch(`/api/wa/session?t=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tenantId, action: "disconnect" }),
        signal: controller.signal,
      });

      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        // aunque falle, refrescamos estado
        setSession(null);
        await fetchSession(controller.signal);
        return;
      }

      setSession(null);
      await fetchSession(controller.signal);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[PublicConnect] handleDisconnect error:", err);
      setError(err?.message || "No se pudo desconectar");
    }
  }

  // --- efecto principal: iniciar + polling ---
  useEffect(() => {
    // reset state por tenant
    connectTriggeredRef.current = false;
    setSession(null);
    setError(null);
    setLastUpdated(null);
    setLoading(true);

    if (!tenantId) {
      setError("El enlace no tiene un negocio válido.");
      setLoading(false);
      return;
    }

    const controller = resetAbort();
    let interval: NodeJS.Timeout | null = null;

    (async () => {
      // 1) primero intentamos leer session
      await fetchSession(controller.signal);

      // 2) si está disconnected/error y no hay QR, disparamos connect UNA sola vez
      //    (si ya estaba qrcode/connecting/connected no lo tocamos)
      const statusNow: SessionStatus = (session?.status as SessionStatus) || "disconnected";
      const hasQrNow = !!session?.qr_data;

      if (!connectTriggeredRef.current) {
        connectTriggeredRef.current = true;

        // re-consultamos directo para no depender de state viejo
        // (evita race con React state)
        try {
          const res = await fetch(
            `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}&t=${Date.now()}`,
            { cache: "no-store", signal: controller.signal }
          );
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const j = (await res.json()) as SessionResponse;
            const s = j?.session;
            const st = (s?.status as SessionStatus) || "disconnected";
            const hq = !!s?.qr_data;

            if ((st === "disconnected" || st === "error") && !hq) {
              await ensureConnectedSession(controller.signal);
            }
          } else {
            // si no es json, lo dejamos que caiga en fetchSession con error visible
            await fetchSession(controller.signal);
          }
        } catch (e: any) {
          if (e?.name !== "AbortError") {
            await ensureConnectedSession(controller.signal);
          }
        }
      }

      // 3) Poll cada 3.5s para actualizar QR / estado
      interval = setInterval(() => {
        fetchSession(controller.signal);
      }, 3500);
    })();

    return () => {
      if (interval) clearInterval(interval);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // key para re-render QR cuando cambia el QR o tenant
  const qrKey = useMemo(() => {
    const prefix = session?.qr_data ? session.qr_data.slice(0, 25) : "noqr";
    return `${tenantId}:${prefix}`;
  }, [tenantId, session?.qr_data]);

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
              <span className="font-mono">{tenantId || "—"}</span>
            </p>
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-3">{error}</p>
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
                  key={qrKey}
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
                {connecting ? "Generando QR..." : "Preparando el código QR..."}
              </p>
              <div className="mx-auto h-6 w-6 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" />
            </div>
          )}

          <p className="mt-6 text-[10px] text-slate-500">
            Powered by PymeBOT • Última actualización: {lastUpdated || "—"}
          </p>
        </div>
      </div>
    </div>
  );
}
