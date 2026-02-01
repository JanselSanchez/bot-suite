// src/app/dashboard/connect-whatsapp/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { Separator } from "@radix-ui/react-separator";
import { Button } from "@/componentes/ui/button";
import { useActiveTenant } from "@/app/providers/active-tenant";
import { LogOut, Link as LinkIcon, Check } from "lucide-react";

type ServerStatus = {
  ok: boolean;
  status: "online" | "waiting_qr" | "starting" | "offline" | string;
};

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

type ActiveTenantResponse = {
  ok: boolean;
  tenantId: string | null;
  tenantName?: string | null;
  waConnected?: boolean;
  waPhone?: string | null;
  waLastConnectedAt?: string | null;
  error?: string;
};

function safeNowTime() {
  try {
    return new Date().toLocaleTimeString();
  } catch {
    return "";
  }
}

export default function ConnectWhatsAppPage() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

  // -----------------------
  // REFS anti "QR pegado"
  // -----------------------
  const tenantRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function newAbortController() {
    if (abortRef.current) abortRef.current.abort();
    const c = new AbortController();
    abortRef.current = c;
    return c;
  }

  // -----------------------
  // UI State
  // -----------------------
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverLoading, setServerLoading] = useState(true);

  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenantWaConnected, setTenantWaConnected] = useState(false);
  const [tenantWaPhone, setTenantWaPhone] = useState<string | null>(null);
  const [tenantWaLastConnectedAt, setTenantWaLastConnectedAt] =
    useState<string | null>(null);

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Estado para el botón de copiar link
  const [copiedLink, setCopiedLink] = useState(false);

  // Helper: headers anti-cache (por si hay proxy caching raro)
  const noCacheHeaders = useMemo(
    () => ({
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    }),
    []
  );

  // 1) Estado global del servidor WA
  async function fetchServerStatus(signal?: AbortSignal) {
    try {
      const res = await fetch(`/api/wa/status?t=${Date.now()}`, {
        cache: "no-store",
        signal,
        headers: noCacheHeaders,
      });
      const json = await res.json();
      setServerStatus({
        ok: json.ok ?? true,
        status: (json.status as ServerStatus["status"]) ?? "online",
      });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[ConnectWhatsApp] fetchServerStatus error:", err);
      setServerStatus({ ok: false, status: "offline" });
    } finally {
      setServerLoading(false);
      setLastUpdated(safeNowTime());
    }
  }

  // 2) Datos del tenant (estado WA guardado en tu BD / backend)
  async function fetchActiveTenant(signal?: AbortSignal) {
    if (!tenantId) {
      setTenantName(null);
      setTenantWaConnected(false);
      setTenantWaPhone(null);
      setTenantWaLastConnectedAt(null);
      return;
    }

    try {
      // Nota: si tu endpoint /api/admin/tenants/activate usa cookies/sesión para saber el tenant activo,
      // esto igual funciona. Si en el futuro aceptas ?tenantId=, aquí se lo pasas y quedas blindado.
      const res = await fetch(
        `/api/admin/tenants/activate?t=${Date.now()}`,
        {
          cache: "no-store",
          signal,
          headers: noCacheHeaders,
        }
      );

      const json = (await res.json()) as ActiveTenantResponse;

      // ✅ Ignora respuestas tardías del tenant anterior (anti-race)
      if (tenantRef.current !== tenantId) return;

      if (json.ok && json.tenantId) {
        setTenantName(json.tenantName ?? json.tenantId);
        setTenantWaConnected(!!json.waConnected);
        setTenantWaPhone(json.waPhone ?? null);
        setTenantWaLastConnectedAt(json.waLastConnectedAt ?? null);
      } else {
        setTenantName(null);
        setTenantWaConnected(false);
        setTenantWaPhone(null);
        setTenantWaLastConnectedAt(null);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[ConnectWhatsApp] fetchActiveTenant error:", err);
    }
  }

  // 3) Sesión WA por negocio (QR real por tenant)
  async function fetchSession(signal?: AbortSignal) {
    if (!tenantId) return;

    setSessionLoading(true);
    try {
      const res = await fetch(
        `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}&t=${Date.now()}`,
        { cache: "no-store", signal, headers: noCacheHeaders }
      );
      const json = (await res.json()) as SessionResponse;

      // ✅ Ignora respuestas tardías del tenant anterior (anti-race)
      if (tenantRef.current !== tenantId) return;

      if (!json.ok) throw new Error(json.error || "Error al cargar sesión de WhatsApp");

      setSession(json.session);
      setSessionError(null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[ConnectWhatsApp] fetchSession error:", err);
      setSession(null);
      setSessionError(err?.message || "Error al cargar sesión de WhatsApp");
    } finally {
      // ✅ solo baja loading si seguimos en el mismo tenant
      if (tenantRef.current === tenantId) setSessionLoading(false);
    }
  }

  // 4) Acción conectar / desconectar
  async function handleAction(action: "connect" | "disconnect") {
    if (!tenantId) return;

    // ✅ al accionar, abortamos cualquier polling en vuelo para evitar pisadas
    const controller = newAbortController();

    setSessionLoading(true);
    setSessionError(null);

    // Optimistic update al desconectar
    if (action === "disconnect") {
      setSession(null);
      setTenantWaConnected(false);
      setTenantWaPhone(null);
      setTenantWaLastConnectedAt(null);
    }

    try {
      const res = await fetch(`/api/wa/session?t=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...noCacheHeaders },
        body: JSON.stringify({ tenantId, action }),
        cache: "no-store",
        signal: controller.signal,
      });

      const json = (await res.json()) as SessionResponse;

      if (tenantRef.current !== tenantId) return;

      if (!json.ok) throw new Error(json.error || "Error al ejecutar acción");

      // ✅ refresca forzado
      await fetchSession(controller.signal);
      await fetchActiveTenant(controller.signal);
      await fetchServerStatus(controller.signal);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("[ConnectWhatsApp] handleAction error:", err);
      setSessionError(err?.message || "Error al ejecutar acción");
    } finally {
      if (tenantRef.current === tenantId) setSessionLoading(false);
    }
  }

  // 5) Copiar Link Remoto (100% tenant real + fallback si clipboard falla)
  const copyRemoteLink = async () => {
    if (!tenantId) return;

    // tenant real que está activo en este instante
    const tid = tenantId;

    const link = `${window.location.origin}/connect/${encodeURIComponent(tid)}`;

    try {
      // Preferido (seguro) si hay permiso
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        // Fallback viejo (por compatibilidad)
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }

      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("[ConnectWhatsApp] copyRemoteLink error:", err);
      // si falla, al menos mostramos el link en consola
      console.log("[ConnectWhatsApp] Link:", link);
    }
  };

  // -----------------------
  // EFFECT: polling + anti-race + abort
  // -----------------------
  useEffect(() => {
    if (loadingTenant) return;

    // ✅ guarda el tenant actual
    tenantRef.current = tenantId ?? null;

    // ✅ aborta requests del tenant anterior
    const controller = newAbortController();

    // ✅ reset fuerte (mata “QR pegado”)
    setSession(null);
    setSessionError(null);
    setSessionLoading(false);

    setTenantName(null);
    setTenantWaConnected(false);
    setTenantWaPhone(null);
    setTenantWaLastConnectedAt(null);

    // ✅ primer fetch inmediato
    fetchServerStatus(controller.signal);
    fetchActiveTenant(controller.signal);
    fetchSession(controller.signal);

    const id = setInterval(() => {
      // Si ya cambió tenant, no sigas poll
      if (tenantRef.current !== (tenantId ?? null)) return;
      fetchServerStatus(controller.signal);
      fetchActiveTenant(controller.signal);
      fetchSession(controller.signal);
    }, 5000);

    return () => {
      clearInterval(id);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, loadingTenant]);

  // -----------------------
  // Derived UI flags
  // -----------------------
  const isServerOnline =
    !serverStatus || serverStatus.status === "online" || serverStatus.ok;

  const rawStatus: SessionStatus = session?.status ?? "disconnected";
  const hasQr = !!session?.qr_data;

  // Conectado si:
  // - backend tenant dice conectado, o
  // - session status conectado,
  // y NO hay QR activo.
  const isConnected =
    !hasQr && (tenantWaConnected || rawStatus === "connected");

  const showQr = hasQr && !isConnected;
  const connectedPhone = tenantWaPhone || session?.phone_number || null;
  const connectedAt =
    tenantWaLastConnectedAt || session?.last_connected_at || null;

  // key para forzar remount del QR por tenant y por contenido (evita reuso visual)
  const qrKey = useMemo(() => {
    const tid = tenantId || "no-tenant";
    const prefix = session?.qr_data ? session.qr_data.slice(0, 24) : "noqr";
    return `${tid}:${prefix}`;
  }, [tenantId, session?.qr_data]);

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-50 flex flex-col items-center">
      <div className="w-full max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-semibold mb-2">
          Conectar WhatsApp del negocio
        </h1>
        <p className="text-slate-300 mb-4">
          Escanea el código QR con el WhatsApp del negocio para vincular el
          asistente.
        </p>

        <div className="flex items-center justify-between text-xs text-slate-400 mb-4">
          <span>
            Estado del servidor WA:{" "}
            {serverLoading ? (
              <span className="text-slate-400">cargando…</span>
            ) : isServerOnline ? (
              <span className="text-emerald-400 font-medium">ONLINE</span>
            ) : (
              <span className="text-red-400 font-medium">OFFLINE</span>
            )}
          </span>
          <span>
            Última actualización: {lastUpdated ? lastUpdated : "cargando..."}
          </span>
        </div>

        <Separator className="bg-slate-800 mb-6" />

        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row gap-6 shadow-xl shadow-black/40">
          <div className="flex-1 flex flex-col items-center justify-center">
            {!isServerOnline && (
              <div className="text-center">
                <p className="text-red-400 text-sm mb-2">
                  El servidor de WhatsApp está OFFLINE.
                </p>
                <p className="text-xs text-slate-500">Contacta soporte.</p>
              </div>
            )}

            {isServerOnline && !tenantId && (
              <div className="text-center">
                <p className="text-amber-300 text-sm mb-2">
                  No se detectó un negocio activo.
                </p>
                <p className="text-xs text-slate-500">
                  Selecciona un negocio arriba.
                </p>
              </div>
            )}

            {isServerOnline && tenantId && (
              <>
                <p className="text-xs text-slate-400 mb-4">
                  Negocio:{" "}
                  <span className="font-medium">{tenantName || tenantId}</span>
                </p>

                {sessionError && (
                  <p className="text-red-400 text-xs mb-2">{sessionError}</p>
                )}

                {sessionLoading && (
                  <p className="text-slate-400 text-sm">Cargando estado...</p>
                )}

                {!sessionLoading &&
                  !isConnected &&
                  !showQr &&
                  rawStatus === "disconnected" && (
                    <div className="text-center">
                      <p className="text-slate-300 text-sm mb-2">
                        Este negocio no tiene WhatsApp vinculado.
                      </p>
                      <Button
                        size="sm"
                        disabled={!isServerOnline}
                        onClick={() => handleAction("connect")}
                      >
                        Generar Código QR
                      </Button>
                    </div>
                  )}

                {!sessionLoading &&
                  !isConnected &&
                  !showQr &&
                  rawStatus === "connecting" && (
                    <div className="text-center">
                      <p className="text-slate-300 text-sm mb-2">
                        Iniciando conexión...
                      </p>
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white mx-auto" />
                    </div>
                  )}

                {!sessionLoading && showQr && (
                  <>
                    <p className="text-sm text-slate-300 mb-3 text-center">
                      Ve a WhatsApp &gt; Configuración &gt; Dispositivos
                      vinculados &gt; Vincular
                    </p>

                    <div className="bg-white p-4 rounded-xl flex justify-center items-center">
                      <QRCode
                        key={qrKey}
                        value={session?.qr_data || ""}
                        size={220}
                        bgColor="#FFFFFF"
                        fgColor="#000000"
                        level="M"
                        style={{
                          height: "auto",
                          maxWidth: "100%",
                          width: "100%",
                        }}
                        viewBox="0 0 256 256"
                      />
                    </div>

                    <p className="text-xs text-slate-400 mt-3 text-center">
                      El QR se actualiza automáticamente.
                    </p>
                  </>
                )}

                {!sessionLoading && isConnected && (
                  <div className="text-center animate-in fade-in zoom-in">
                    <p className="text-emerald-400 font-medium mb-2 text-lg">
                      ✅ WhatsApp Conectado
                    </p>
                    <p className="text-xs text-slate-500 mb-4">
                      Número:{" "}
                      <span className="font-semibold text-slate-300">
                        {connectedPhone || "..."}
                      </span>
                    </p>

                    <Button
                      variant="destructive"
                      size="sm"
                      className="bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
                      onClick={() => {
                        if (confirm("¿Seguro que deseas desconectar el bot?")) {
                          handleAction("disconnect");
                        }
                      }}
                    >
                      <LogOut className="w-4 h-4 mr-2" />
                      Desvincular Sesión
                    </Button>

                    {connectedAt && (
                      <p className="text-[10px] text-slate-600 mt-4">
                        Conectado desde:{" "}
                        {new Date(connectedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                )}

                {!sessionLoading &&
                  !showQr &&
                  !isConnected &&
                  rawStatus === "error" && (
                    <div className="text-center">
                      <p className="text-red-400 text-sm mb-2">
                        Error en la sesión.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction("connect")}
                      >
                        Reintentar
                      </Button>
                    </div>
                  )}
              </>
            )}
          </div>

          <div className="md:w-64 bg-slate-950/60 border border-slate-800 rounded-2xl p-4 text-sm flex flex-col gap-3">
            {/* --- SECCIÓN: BOTÓN LINK REMOTO --- */}
            <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3 mb-2">
              <p className="text-xs text-violet-300 mb-2 font-medium">
                ¿Cliente remoto?
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="w-full bg-violet-600 hover:bg-violet-700 text-white border-none flex gap-2 items-center justify-center text-xs"
                onClick={copyRemoteLink}
                disabled={!tenantId}
              >
                {copiedLink ? (
                  <Check className="w-3 h-3" />
                ) : (
                  <LinkIcon className="w-3 h-3" />
                )}
                {copiedLink ? "¡Copiado!" : "Copiar Link de Conexión"}
              </Button>
              <p className="text-[10px] text-slate-500 mt-2 leading-tight">
                Envía este enlace para que el cliente pueda escanear el QR desde
                su casa.
              </p>
            </div>

            <Separator className="bg-slate-800 my-1" />

            <h2 className="font-semibold text-slate-100 mb-1">Instrucciones</h2>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 text-xs">
              <li>Abre WhatsApp en el celular.</li>
              <li>Ve a Configuración.</li>
              <li>Toca &quot;Dispositivos vinculados&quot;.</li>
              <li>Escanea el código QR.</li>
            </ol>

            <Separator className="bg-slate-800 my-2" />

            <Button
              variant="outline"
              size="sm"
              className="mt-2 border-slate-700 text-slate-200 hover:bg-slate-800"
              onClick={() => {
                const controller = newAbortController();
                fetchServerStatus(controller.signal);
                fetchActiveTenant(controller.signal);
                fetchSession(controller.signal);
              }}
            >
              Refrescar estado
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
