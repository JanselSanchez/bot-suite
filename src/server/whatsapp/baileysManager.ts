// src/app/server/whatsapp/baileysManager.ts

/************************************************************
 * FIX TLS (lo tenías así para dev; en Render normalmente no hace falta,
 * pero lo mantengo para no romper nada que ya te funcione con Supabase).
 ************************************************************/
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

export type SessionStatus =
  | "disconnected"
  | "qrcode"
  | "connecting"
  | "connected"
  | "error";

interface SessionInfo {
  socket: WASocket;
  tenantId: string;
  sessionId: string;
  status: SessionStatus;
  lastQr?: string;
}

// Sesiones vivas en memoria (por proceso)
const sessions = new Map<string, SessionInfo>();
const key = (sessionId: string) => sessionId;

/**
 * Obtener info de sesión en memoria (por si quieres leer estado desde otro sitio)
 */
export function getSessionInfo(sessionId: string): SessionInfo | null {
  return sessions.get(key(sessionId)) ?? null;
}

/**
 * Crea o recupera una sesión Baileys asociada a un sessionId (uuid)
 * y un tenantId.
 *
 * IMPORTANTE:
 * - Úsalo SOLO desde el endpoint de "conectar / iniciar sesión".
 * - El endpoint de "status" debe leer estado desde la tabla whatsapp_sessions,
 *   NO debe llamar a esta función, para no tocar la sesión innecesariamente.
 */
export async function getOrCreateSession(sessionId: string, tenantId: string) {
  const k = key(sessionId);
  const existing = sessions.get(k);
  if (existing) {
    console.log("[baileysManager] Reutilizando sesión en memoria:", sessionId);
    return existing;
  }

  console.log("[baileysManager] Creando nueva sesión:", { sessionId, tenantId });

  // 1) Verificar que exista la fila en DB
  const { data, error } = await supabaseAdmin
    .from("whatsapp_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    console.error(
      "[baileysManager] whatsapp_sessions no encontrada:",
      sessionId,
      "error:",
      error
    );
    throw new Error("Session not found");
  }

  // 2) Auth de Baileys en disco (session por negocio)
  const sessionPath = `./.wa_sessions/${sessionId}`;
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  // 3) Crear socket
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  const info: SessionInfo = {
    socket: sock,
    tenantId,
    sessionId,
    status: "connecting",
  };

  sessions.set(k, info);

  /**************************************
   * EVENTOS DE BAILEYS
   **************************************/
  sock.ev.process(async (events) => {
    /*********** QR / conexión ***********/
    if (events["connection.update"]) {
      const { connection, lastDisconnect, qr } = events["connection.update"];

      console.log(
        "[baileysManager][connection.update]",
        sessionId,
        "connection=",
        connection,
        "qr?",
        !!qr
      );

      if (qr) {
        info.status = "qrcode";
        info.lastQr = qr;

        await supabaseAdmin
          .from("whatsapp_sessions")
          .update({
            status: "qrcode",
            qr_data: qr,
            qr_svg: null,
            qr_expires_at: new Date(Date.now() + 60_000),
            last_error: null,
          })
          .eq("id", sessionId);
      }

      /*********** Conectado ***********/
      if (connection === "open") {
        info.status = "connected";

        // Extraer número de WhatsApp desde el JID
        let phone: string | null = null;
        try {
          const jid = sock?.user?.id || ""; // ej: "18099490457:1@s.whatsapp.net"
          const raw = jid.split("@")[0].split(":")[0];
          if (raw) phone = `whatsapp:+${raw}`;
        } catch {
          phone = null;
        }

        // Actualizar sesión en DB
        await supabaseAdmin
          .from("whatsapp_sessions")
          .update({
            status: "connected",
            qr_data: null,
            qr_svg: null,
            phone_number: phone,
            last_connected_at: new Date(),
            last_seen_at: new Date(),
            last_error: null,
          })
          .eq("id", sessionId);

        // Actualizar tenant para que el panel lo lea
        await supabaseAdmin
          .from("tenants")
          .update({
            wa_connected: true,
            wa_phone: phone,
            wa_last_connected_at: new Date(),
          })
          .eq("id", tenantId);

        console.log(
          "[baileysManager] ✅ Conectado sesión",
          sessionId,
          "tel:",
          phone
        );
      }

      /*********** Cerrado ***********/
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        info.status = "disconnected";

        console.warn(
          "[baileysManager] ❌ Conexión cerrada:",
          sessionId,
          "statusCode=",
          statusCode,
          "shouldReconnect=",
          shouldReconnect
        );

        await supabaseAdmin
          .from("whatsapp_sessions")
          .update({
            status: "disconnected",
            last_seen_at: new Date(),
            last_error: lastDisconnect?.error?.toString() ?? null,
          })
          .eq("id", sessionId);

        // Marcar tenant como desconectado
        await supabaseAdmin
          .from("tenants")
          .update({
            wa_connected: false,
          })
          .eq("id", tenantId);

        if (!shouldReconnect) {
          // Sesión cerrada definitivamente (p.ej. desde el celular → cerrar sesión)
          sessions.delete(k);
        } else {
          // Dejas que se vuelva a conectar en un próximo getOrCreateSession,
          // o aquí mismo podrías reintentar:
          // setTimeout(() => getOrCreateSession(sessionId, tenantId).catch(console.error), 2000);
          sessions.delete(k); // para que el próximo getOrCreate cree una nueva
        }
      }
    }

    /*********** Credenciales ***********/
    if (events["creds.update"]) {
      await saveCreds();
    }
  });

  return info;
}

/**
 * Desconectar sesión (desde el panel)
 */
export async function disconnectSession(sessionId: string) {
  const s = sessions.get(key(sessionId));
  if (s) {
    try {
      await s.socket.logout();
    } catch (e) {
      console.error("[baileysManager] Error haciendo logout:", e);
    }
    sessions.delete(key(sessionId));
  }

  await supabaseAdmin
    .from("whatsapp_sessions")
    .update({
      status: "disconnected",
      qr_data: null,
      qr_svg: null,
      last_seen_at: new Date(),
    })
    .eq("id", sessionId);
}
