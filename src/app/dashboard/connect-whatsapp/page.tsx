// src/app/dashboard/connect-whatsapp/page.tsx
"use client";

import { Button } from "@/componentes/ui/button";
import { Separator } from "@radix-ui/react-separator";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";

type WaStatus = {
  ok: boolean;
  status: "online" | "offline";
  // Opcionales, por si en algún momento los rellenas desde el backend:
  health?: {
    ok: boolean;
    service: string;
    connected: boolean;
  } | null;
  qr?: {
    ok: boolean;
    qr: string | null;
    message?: string;
  } | null;
  upstream?: {
    httpStatus: number;
    raw: string;
    json: any;
  };
};

// Este es el tenant al que está realmente vinculado el número de WhatsApp
// (el mismo que configuraste en el .env / Render)
const WA_TENANT_ID =
  process.env.NEXT_PUBLIC_WA_DEFAULT_TENANT_ID || "creativadominicana";

export default function ConnectWhatsAppPage() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // tenant “actual” que está usando el panel
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);

  // Detectamos el tenant actual (querystring, localStorage, fallback)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    const fromQuery =
      url.searchParams.get("tenant") ||
      url.searchParams.get("tenantId") ||
      url.searchParams.get("t");

    const fromStorage =
      window.localStorage.getItem("pb_current_tenant_id") ||
      window.localStorage.getItem("current_tenant");

    const detected = fromQuery || fromStorage || WA_TENANT_ID;
    setCurrentTenantId(detected);
  }, []);

  async function fetchStatus() {
    try {
      // 🔹 Ahora usamos /api/wa, que es el endpoint de health real
      const res = await fetch("/api/wa", { cache: "no-store" });
      const json = (await res.json()) as WaStatus;
      setStatus(json);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Error cargando estado WA:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();

    // Poll cada 3 segundos para actualizar estado
    const id = setInterval(fetchStatus, 3000);
    return () => clearInterval(id);
  }, []);

  // Solo consideramos “conectado” si:
  // 1) El WA server está conectado (en un futuro, podrías basarte en health.connected)
  // 2) No hay QR pendiente
  // 3) El negocio actual ES el que está vinculado al número (WA_TENANT_ID)
  const isTenantWithWa =
    !currentTenantId || currentTenantId === WA_TENANT_ID; // si no detectamos tenant, asumimos el principal

  // De momento, como /api/wa no devuelve health/qr,
  // estos flags serán falsos hasta que decidas alimentarlos desde el backend:
  const isConnected =
    isTenantWithWa &&
    !!status?.health?.connected &&
    !status?.qr?.qr;

  const hasQr = isTenantWithWa && !!status?.qr?.qr;

  const isServerOnline = !!status?.ok && status?.status === "online";

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
            {isServerOnline ? (
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

        {/* Card principal */}
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row gap-6 shadow-xl shadow-black/40">
          <div className="flex-1 flex flex-col items-center justify-center">
            {/* Si el tenant actual NO es el que tiene asignado el WhatsApp,
                mostramos un mensaje claro y NO enseñamos el QR */}
            {currentTenantId &&
              currentTenantId !== WA_TENANT_ID &&
              isServerOnline && (
                <div className="text-center max-w-md">
                  <p className="text-amber-300 font-medium mb-2">
                    Este número de WhatsApp está vinculado al negocio{" "}
                    <span className="underline">{WA_TENANT_ID}</span>.
                  </p>
                  <p className="text-xs text-slate-400 mb-3">
                    El negocio actual ({currentTenantId}) aún no tiene un
                    número de WhatsApp conectado. Para este cliente puedes:
                  </p>
                  <ul className="text-xs text-slate-400 list-disc list-inside space-y-1 mb-3 text-left">
                    <li>Configurarle otro número con Baileys.</li>
                    <li>
                      O migrar este mismo número y actualizar el tenant
                      asignado en el panel de administración.
                    </li>
                  </ul>
                  <p className="text-xs text-slate-500">
                    Para evitar problemas, no mostramos el QR aquí porque
                    pertenece a otro negocio.
                  </p>
                </div>
              )}

            {/* Flujo normal (tenant correcto) */}
            {isTenantWithWa && (
              <>
                {loading && (
                  <p className="text-slate-400 text-sm">
                    Cargando estado de WhatsApp...
                  </p>
                )}

                {!loading && !status?.ok && (
                  <p className="text-red-400 text-sm">
                    No se pudo obtener el estado del servidor de WhatsApp.
                    Verifica que el servicio esté corriendo.
                  </p>
                )}

                {!loading && status?.ok && (
                  <>
                    {hasQr && (
                      <>
                        <p className="text-sm text-slate-300 mb-3 text-center">
                          Abre WhatsApp o WhatsApp Business en el móvil del
                          negocio y ve a{" "}
                          <span className="font-semibold">
                            Configuración &gt; Dispositivos vinculados &gt;
                            Vincular un dispositivo
                          </span>{" "}
                          y escanea este código:
                        </p>
                        <div className="bg-white p-4 rounded-xl">
                          <QRCode value={status.qr?.qr || ""} size={220} />
                        </div>
                        <p className="text-xs text-slate-400 mt-3 text-center">
                          Si el QR expira, se actualizará solo en unos segundos.
                        </p>
                      </>
                    )}

                    {isConnected && (
                      <div className="text-center">
                        <p className="text-emerald-400 font-medium mb-2">
                          ✅ WhatsApp conectado correctamente
                        </p>
                        <p className="text-xs text-slate-400 mb-3">
                          Ya puedes cerrar esta pantalla. El asistente está
                          respondiendo mensajes en este número.
                        </p>
                      </div>
                    )}

                    {!hasQr && !isConnected && (
                      <div className="text-center">
                        <p className="text-slate-300 text-sm mb-2">
                          Inicializando conexión con WhatsApp...
                        </p>
                        <p className="text-xs text-slate-500">
                          Si esto tarda más de 30 segundos, reinicia el servidor
                          de WhatsApp o contacta soporte.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Lado derecho: instrucciones */}
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
              onClick={fetchStatus}
            >
              Refrescar ahora
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
