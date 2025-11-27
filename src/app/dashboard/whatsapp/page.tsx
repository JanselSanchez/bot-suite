"use client";

import { Button } from "@/componentes/ui/button";
import { useEffect, useState } from "react";

type SessionStatus = "disconnected" | "qrcode" | "connecting" | "connected" | "error";

interface SessionDTO {
  id: string;
  status: SessionStatus;
  qr_svg?: string | null;
  qr_data?: string | null;
  phone_number?: string | null;
  last_connected_at?: string | null;
}

// TODO: reemplazar por tu hook real de tenant actual
function useCurrentTenant() {
  // mock temporal
  return { tenantId: "TENANT_ID", tenantName: "Negocio Demo" };
}

export default function WhatsappPage() {
  const { tenantId, tenantName } = useCurrentTenant();

  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<SessionDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchSession() {
    if (!tenantId) return;
    try {
      const res = await fetch(
        `/api/whatsapp/session?tenantId=${encodeURIComponent(tenantId)}`,
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al cargar sesión");
      setSession(json.session ?? null);
      setError(null);
    } catch (e: any) {
      console.error("[WhatsappPage] fetchSession error:", e);
      setError(e?.message || "Error al cargar sesión");
    }
  }

  useEffect(() => {
    fetchSession();
    const interval = setInterval(fetchSession, 5000); // polling cada 5s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function handleAction(action: "connect" | "disconnect") {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/whatsapp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, action }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Error al ejecutar acción");
      await fetchSession();
    } catch (e: any) {
      console.error("[WhatsappPage] handleAction error:", e);
      setError(e?.message || "Error al ejecutar acción");
    } finally {
      setLoading(false);
    }
  }

  const status: SessionStatus = session?.status ?? "disconnected";

  return (
    <div className="max-w-xl mx-auto mt-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp del negocio</h1>
        <p className="text-sm text-muted-foreground">
          Negocio seleccionado: <span className="font-medium">{tenantName}</span>
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-500 border border-red-500/30 rounded-md p-2">
          {error}
        </div>
      )}

      <div className="border rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Estado de WhatsApp</p>
            <p className="text-xs text-muted-foreground">
              {status === "connected" && "Conectado ✅"}
              {status === "disconnected" && "No conectado"}
              {status === "connecting" && "Conectando…"}
              {status === "qrcode" && "Escanea el código para conectar"}
              {status === "error" && "Error en la sesión"}
            </p>
          </div>

          <div className="flex gap-2">
            {status !== "connected" && (
              <Button
                size="sm"
                disabled={loading || !tenantId}
                onClick={() => handleAction("connect")}
              >
                {loading ? "Conectando..." : "Conectar WhatsApp"}
              </Button>
            )}
            {status === "connected" && (
              <Button
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => handleAction("disconnect")}
              >
                Desconectar
              </Button>
            )}
          </div>
        </div>

        {status === "connected" && (
          <div className="text-sm text-muted-foreground border-t pt-3">
            <p>
              Número conectado:{" "}
              <span className="font-medium">{session?.phone_number || "N/D"}</span>
            </p>
            {session?.last_connected_at && (
              <p className="text-xs">
                Última conexión:{" "}
                {new Date(session.last_connected_at).toLocaleString()}
              </p>
            )}
          </div>
        )}

        {status === "qrcode" && (
          <div className="flex flex-col items-center justify-center gap-3 border-t pt-3">
            <p className="text-sm text-muted-foreground">
              Abre WhatsApp en tu teléfono &gt; Dispositivos vinculados &gt; Vincular
              dispositivo.
            </p>

            {session?.qr_svg ? (
              <div
                className="bg-white p-2 rounded-md"
                dangerouslySetInnerHTML={{ __html: session.qr_svg }}
              />
            ) : session?.qr_data ? (
              <div className="text-xs text-center text-muted-foreground">
                QR recibido (usar componente de QR en el frontend).
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                Generando código QR…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
