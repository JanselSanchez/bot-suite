"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type WaStatus = {
  ok: boolean;
  tenantId: string;
  connected?: boolean;
  hasQr?: boolean;
  qr?: string | null;
  message?: string;
};

export default function WhatsappPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // por ahora, si no hay tenantId en la URL, usamos el default
  const tenantId =
    searchParams.get("tenantId") || process.env.NEXT_PUBLIC_WA_DEFAULT_TENANT_ID || "creativadominicana";

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // polling del QR / estado
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    async function fetchQr() {
      try {
        const res = await fetch(`/api/wa/qr?tenantId=${tenantId}`);
        const data: WaStatus = await res.json();
        setStatus(data);
        setError(null);

        // si todavía no está conectado y no hay error, seguimos preguntando
        if (!data.connected) {
          timer = setTimeout(fetchQr, 3000);
        }
      } catch (err: any) {
        console.error(err);
        setError("Error consultando el estado de WhatsApp.");
      }
    }

    fetchQr();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [tenantId]);

  async function handleStart() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/wa/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      const data: WaStatus = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.message || "Error iniciando sesión de WhatsApp");
      }

      setStatus(data);
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Error iniciando sesión de WhatsApp.");
    } finally {
      setLoading(false);
    }
  }

  const qrValue = status?.qr || null;
  const connected = status?.connected;

  // usamos un servicio externo para convertir el texto del QR en imagen
  const qrImageUrl = qrValue
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(
        qrValue,
      )}`
    : null;

  return (
    <div className="max-w-2xl mx-auto py-10 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Conectar WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Tenant actual: <span className="font-medium">{tenantId}</span>
        </p>
      </div>

      <div className="border rounded-xl p-6 space-y-4 bg-white/5">
        <p className="text-sm">
          Aquí conectas el número de WhatsApp de tu negocio. Solo tienes que
          pulsar el botón, escanear el QR desde WhatsApp &gt; Dispositivos
          vinculados y listo.
        </p>

        <button
          onClick={handleStart}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
        >
          {loading ? "Iniciando..." : "Iniciar / refrescar sesión"}
        </button>

        {error && (
          <p className="text-sm text-red-500">
            {error}
          </p>
        )}

        {connected && !qrValue && (
          <p className="text-sm text-emerald-500 font-medium">
            ✅ WhatsApp conectado correctamente. El bot ya puede responder.
          </p>
        )}

        {!connected && (
          <p className="text-sm text-yellow-500">
            Esperando conexión... si es la primera vez, escanea el QR desde tu
            WhatsApp.
          </p>
        )}

        {qrImageUrl && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <img
              src={qrImageUrl}
              alt="QR de WhatsApp"
              className="rounded-xl border bg-white"
            />
            <p className="text-xs text-muted-foreground text-center max-w-xs">
              Abre WhatsApp en tu teléfono &gt; Dispositivos vinculados &gt;
              Vincular un dispositivo, y escanea este código.
            </p>
          </div>
        )}

        {status?.message && (
          <p className="text-xs text-muted-foreground mt-2">
            {status.message}
          </p>
        )}
      </div>
    </div>
  );
}
