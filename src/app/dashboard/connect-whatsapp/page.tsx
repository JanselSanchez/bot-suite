// src/app/dashboard/connect-whatsapp/page.tsx
"use client";

import { useEffect, useState } from "react";
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

export default function ConnectWhatsAppPage() {
  const { tenantId, loading: loadingTenant } = useActiveTenant();

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

  // 1) Estado global del servidor WA
  async function fetchServerStatus() {
    try {
      const res = await fetch("/api/wa/status", { cache: "no-store" });
      const json = await res.json();
      setServerStatus({
        ok: json.ok ?? true,
        status: (json.status as ServerStatus["status"]) ?? "online",
      });
    } catch (err) {
      console.error("[ConnectWhatsApp] fetchServerStatus error:", err);
      setServerStatus({ ok: false, status: "offline" });
    } finally {
      setServerLoading(false);
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }

  // 2) Datos del tenant
  async function fetchActiveTenant() {
    if (!tenantId) {
      setTenantName(null);
      setTenantWaConnected(false);
      setTenantWaPhone(null);
      setTenantWaLastConnectedAt(null);
      return;
    }
    try {
      const res = await fetch("/api/admin/tenants/activate", {
        cache: "no-store",
      });
      const json = (await res.json()) as ActiveTenantResponse;

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
    } catch (err) {
      console.error("[ConnectWhatsApp] fetchActiveTenant error:", err);
    }
  }

  // 3) Sesión WA por negocio
  async function fetchSession() {
    if (!tenantId) return;
    setSessionLoading(true);
    try {
      const res = await fetch(
        `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" }
      );
      const json = (await res.json()) as SessionResponse;

      if (!json.ok) {
        throw new Error(json.error || "Error al cargar sesión de WhatsApp");
      }
      setSession(json.session);
      setSessionError(null);
    } catch (err: any) {
      console.error("[ConnectWhatsApp] fetchSession error:", err);
      setSession(null);
      setSessionError(err?.message || "Error al cargar sesión de WhatsApp");
    } finally {
      setSessionLoading(false);
    }
  }

  // 4) Acción conectar / desconectar
  async function handleAction(action: "connect" | "disconnect") {
    if (!tenantId) return;
    setSessionLoading(true);

    // Optimistic update al desconectar
    if (action === "disconnect") {
      setSession(null);
      setTenantWaConnected(false);
    }

    try {
      const res = await fetch("/api/wa/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, action }),
      });
      const json = (await res.json()) as SessionResponse;

      if (!json.ok) {
        throw new Error(json.error || "Error al ejecutar acción");
      }
      await fetchSession();
      await fetchActiveTenant();
    } catch (err: any) {
      console.error("[ConnectWhatsApp] handleAction error:", err);
      setSessionError(err?.message || "Error al ejecutar acción");
    } finally {
      setSessionLoading(false);
    }
  }

  // 5) Copiar Link Remoto
  const copyRemoteLink = () => {
    if (!tenantId) return;
    try {
      const link = `${window.location.origin}/connect/${tenantId}`;
      navigator.clipboard.writeText(link);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("[ConnectWhatsApp] copyRemoteLink error:", err);
    }
  };

  useEffect(() => {
    if (loadingTenant) return;

    setSession(null);
    setSessionError(null);

    fetchServerStatus();
    fetchActiveTenant();
    fetchSession();

    const id = setInterval(() => {
      fetchServerStatus();
      fetchActiveTenant();
      fetchSession();
    }, 5000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, loadingTenant]);

  const isServerOnline =
    !serverStatus || serverStatus.status === "online" || serverStatus.ok;

  const rawStatus: SessionStatus = session?.status ?? "disconnected";
  const hasQr = !!session?.qr_data;
  const isConnected =
    !hasQr && (tenantWaConnected || rawStatus === "connected");
  const showQr = hasQr && !isConnected;
  const connectedPhone = tenantWaPhone || session?.phone_number || null;
  const connectedAt = tenantWaLastConnectedAt || session?.last_connected_at || null;

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
            Última actualización:{" "}
            {lastUpdated ? lastUpdated : "cargando..."}
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
                  <span className="font-medium">
                    {tenantName || tenantId}
                  </span>
                </p>

                {sessionError && (
                  <p className="text-red-400 text-xs mb-2">
                    {sessionError}
                  </p>
                )}

                {sessionLoading && (
                  <p className="text-slate-400 text-sm">
                    Cargando estado...
                  </p>
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
                        if (
                          confirm(
                            "¿Seguro que deseas desconectar el bot?"
                          )
                        ) {
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
                Envía este enlace para que el cliente pueda escanear el QR
                desde su casa.
              </p>
            </div>

            <Separator className="bg-slate-800 my-1" />

            <h2 className="font-semibold text-slate-100 mb-1">
              Instrucciones
            </h2>
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
                fetchServerStatus();
                fetchActiveTenant();
                fetchSession();
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
