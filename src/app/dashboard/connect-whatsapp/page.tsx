// src/app/dashboard/connect-whatsapp/page.tsx
"use client";

import { Button } from "@/componentes/ui/button";
import { Separator } from "@radix-ui/react-separator";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";

type ServerStatus = {
  ok: boolean;
  status: "online" | "offline";
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

  // NUEVOS CAMPOS (venir de la API /api/admin/tenants/activate)
  waConnected?: boolean;
  waPhone?: string | null;
  waLastConnectedAt?: string | null;

  error?: string;
};

export default function ConnectWhatsAppPage() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [serverLoading, setServerLoading] = useState(true);

  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);

  // estado de WhatsApp a nivel de tenant (columna tenants.wa_connected, etc.)
  const [tenantWaConnected, setTenantWaConnected] = useState(false);
  const [tenantWaPhone, setTenantWaPhone] = useState<string | null>(null);
  const [tenantWaLastConnectedAt, setTenantWaLastConnectedAt] = useState<
    string | null
  >(null);

  const [session, setSession] = useState<SessionDTO | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // 1) Estado global del servidor WA
  async function fetchServerStatus() {
    try {
      const res = await fetch("/api/wa", { cache: "no-store" });
      const json = (await res.json()) as ServerStatus;
      setServerStatus(json);
    } catch (err) {
      console.error("[ConnectWhatsApp] fetchServerStatus error:", err);
      setServerStatus({ ok: false, status: "offline" });
    } finally {
      setServerLoading(false);
      setLastUpdated(new Date().toLocaleTimeString());
    }
  }

  // 2) Tenant activo (cookie pyme.active_tenant)
  async function fetchActiveTenant() {
    try {
      const res = await fetch("/api/admin/tenants/activate", {
        cache: "no-store",
      });
      const json = (await res.json()) as ActiveTenantResponse;

      if (json.ok && json.tenantId) {
        setTenantId(json.tenantId);
        setTenantName(json.tenantName ?? json.tenantId);

        // 👉 aquí leemos el estado real de WhatsApp del tenant
        setTenantWaConnected(!!json.waConnected);
        setTenantWaPhone(json.waPhone ?? null);
        setTenantWaLastConnectedAt(json.waLastConnectedAt ?? null);
      } else {
        setTenantId(null);
        setTenantName(null);
        setTenantWaConnected(false);
        setTenantWaPhone(null);
        setTenantWaLastConnectedAt(null);
      }
    } catch (err) {
      console.error("[ConnectWhatsApp] fetchActiveTenant error:", err);
      setTenantId(null);
      setTenantName(null);
      setTenantWaConnected(false);
      setTenantWaPhone(null);
      setTenantWaLastConnectedAt(null);
    }
  }

  // 3) Sesión WA por negocio (usa /api/wa/session)
  async function fetchSession() {
    if (!tenantId) return;
    setSessionLoading(true);
    try {
      const res = await fetch(
        `/api/wa/session?tenantId=${encodeURIComponent(tenantId)}`,
        { cache: "no-store" },
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

  // 4) Acción conectar / desconectar para este negocio
  async function handleAction(action: "connect" | "disconnect") {
    if (!tenantId) return;
    setSessionLoading(true);
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
      // después de conectar/desconectar, refrescamos también el tenant
      await fetchActiveTenant();
    } catch (err: any) {
      console.error("[ConnectWhatsApp] handleAction error:", err);
      setSessionError(err?.message || "Error al ejecutar acción");
    } finally {
      setSessionLoading(false);
    }
  }

  // Cargar servidor + tenant al montar
  useEffect(() => {
    fetchServerStatus();
    fetchActiveTenant();

    const id = setInterval(() => {
      fetchServerStatus();
      fetchSession();
      fetchActiveTenant();
    }, 5000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cuando cambie el tenant → cargar su sesión
  useEffect(() => {
    if (!tenantId) return;
    fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const isServerOnline =
    !!serverStatus?.ok && serverStatus.status === "online";

  const rawStatus: SessionStatus = session?.status ?? "disconnected";

  // 👉 verdad absoluta de conexión:
  // - si el tenant dice que está conectado, creemos al tenant
  // - si no, miramos el status de la sesión
  const isConnected = tenantWaConnected || rawStatus === "connected";

  // mostrar QR solo si NO está conectado
  const showQr = !isConnected && rawStatus === "qrcode" && !!session?.qr_data;

  // datos del número conectado (primero tenant, luego sesión)
  const connectedPhone = tenantWaPhone || session?.phone_number || null;
  const connectedAt =
    tenantWaLastConnectedAt || session?.last_connected_at || null;

  return (
    <div className="min-h-screen w-full bg-slate-950 text-slate-50 flex flex-col items-center">
      <div className="w-full max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-semibold mb-2">
          Conectar WhatsApp del negocio
        </h1>
        <p className="text-slate-300 mb-4">
          Escanea el código QR con el WhatsApp del negocio para vincular el
          asistente. Esta vinculación se hace una sola vez.
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
                <p className="text-xs text-slate-500">
                  Enciende el servidor Baileys o contacta soporte antes de
                  intentar vincular un número.
                </p>
              </div>
            )}

            {isServerOnline && !tenantId && (
              <div className="text-center">
                <p className="text-amber-300 text-sm mb-2">
                  No se detectó un negocio activo.
                </p>
                <p className="text-xs text-slate-500">
                  Selecciona un negocio en el selector superior para vincular su
                  WhatsApp.
                </p>
              </div>
            )}

            {isServerOnline && tenantId && (
              <>
                <p className="text-xs text-slate-400 mb-4">
                  Negocio seleccionado:{" "}
                  <span className="font-medium">
                    {tenantName || tenantId}
                  </span>
                </p>

                {sessionError && (
                  <p className="text-red-400 text-xs mb-2">{sessionError}</p>
                )}

                {sessionLoading && (
                  <p className="text-slate-400 text-sm">
                    Cargando estado de WhatsApp...
                  </p>
                )}

                {/* 👉 SOLO mostramos el texto de "no tiene WhatsApp" si REALMENTE no está conectado */}
                {!sessionLoading && !isConnected && rawStatus === "disconnected" && (
                  <div className="text-center">
                    <p className="text-slate-300 text-sm mb-2">
                      Este negocio aún no tiene WhatsApp vinculado.
                    </p>
                    <p className="text-xs text-slate-500 mb-3">
                      Pulsa el botón para iniciar la vinculación y generar un
                      código QR único para este negocio.
                    </p>
                    <Button
                      size="sm"
                      disabled={!isServerOnline}
                      onClick={() => handleAction("connect")}
                    >
                      Conectar WhatsApp
                    </Button>
                  </div>
                )}

                {!sessionLoading && !isConnected && rawStatus === "connecting" && (
                  <div className="text-center">
                    <p className="text-slate-300 text-sm mb-2">
                      Inicializando conexión con WhatsApp...
                    </p>
                    <p className="text-xs text-slate-500">
                      Si esto tarda más de 30 segundos, reinicia el servidor de
                      WhatsApp o contacta soporte.
                    </p>
                  </div>
                )}

                {!sessionLoading && showQr && (
                  <>
                    <p className="text-sm text-slate-300 mb-3 text-center">
                      Abre WhatsApp o WhatsApp Business en el móvil del negocio
                      y ve a{" "}
                      <span className="font-semibold">
                        Configuración &gt; Dispositivos vinculados &gt; Vincular
                        un dispositivo
                      </span>{" "}
                      y escanea este código:
                    </p>
                    <div className="bg.white p-4 rounded-xl">
                      <QRCode value={session?.qr_data || ""} size={220} />
                    </div>
                    <p className="text-xs text-slate-400 mt-3 text-center">
                      Si el QR expira, se actualizará solo en unos segundos.
                    </p>
                  </>
                )}

                {/* 👉 Bloque para negocio ya conectado (usa tenant.wa_connected) */}
                {!sessionLoading && isConnected && (
                  <div className="text-center">
                    <p className="text-emerald-400 font-medium mb-2">
                      ✅ WhatsApp conectado correctamente
                    </p>
                    <p className="text-xs text-slate-400 mb-3">
                      Ya puedes cerrar esta pantalla. El asistente está
                      respondiendo mensajes en este número.
                    </p>
                    <p className="text-xs text-slate-500 mb-1">
                      Número conectado:{" "}
                      <span className="font-semibold">
                        {connectedPhone || "N/D"}
                      </span>
                    </p>
                    {connectedAt && (
                      <p className="text-[10px] text-slate-500">
                        Última conexión:{" "}
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
                        Hubo un error en la sesión de WhatsApp.
                      </p>
                      <p className="text-xs text-slate-500 mb-3">
                        Intenta reconectar el número. Si persiste, reinicia el
                        servidor de WhatsApp.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAction("connect")}
                      >
                        Reintentar conexión
                      </Button>
                    </div>
                  )}
              </>
            )}
          </div>

          <div className="md:w-64 bg-slate-950/60 border border-slate-800 rounded-2xl p-4 text-sm flex flex-col gap-3">
            <h2 className="font-semibold text-slate-100 mb-1">
              Instrucciones rápidas
            </h2>
            <ol className="list-decimal list-inside space-y-1 text-slate-300">
              <li>Ten en la mano el celular del negocio.</li>
              <li>Abre WhatsApp o WhatsApp Business.</li>
              <li>
                Ve a{" "}
                <span className="font-semibold">
                  Configuración → Dispositivos vinculados
                </span>
                .
              </li>
              <li>Elige “Vincular un dispositivo”.</li>
              <li>Escanea el código QR que ves en esta pantalla.</li>
            </ol>

            <Separator className="bg-slate-800 my-2" />

            <p className="text-xs text-slate-400">
              Si el cliente está remoto, puedes enviarle el enlace a esta
              pantalla y decirle que siga estos pasos. No necesitas ir al local
              físicamente.
            </p>

            <Button
              variant="outline"
              size="sm"
              className="mt-2 border-slate-700 text-slate-200 hover:bg-slate-800"
              onClick={() => {
                fetchServerStatus();
                fetchSession();
                fetchActiveTenant();
              }}
            >
              Refrescar ahora
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
