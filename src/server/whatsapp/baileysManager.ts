// src/server/whatsapp/baileysManager.ts

/************************************************************
 * IMPORTANTE
 * - Este manager se usa SOLO en el backend (Next API routes).
 * - Cada tenant tiene SU PROPIA sesión (sessionId en whatsapp_sessions).
 * - El QR se emite UNA sola vez por sesión activa y se actualiza
 *   sólo cuando Baileys lo renueva.
 ************************************************************/

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  Browsers,
  fetchLatestBaileysVersion,
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

/**
 * En PRODUCCIÓN (Render) NO deberías necesitar esto.
 * Si lo necesitas por un proxy raro, configura la var de entorno
 * en Render: NODE_TLS_REJECT_UNAUTHORIZED=0
 * y borra esta línea.
 */
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Sesiones vivas en memoria (por proceso)
const sessions = new Map<string, SessionInfo>();
const key = (sessionId: string) => sessionId;

// Cache de versión WA para no llamar a fetchLatestBaileysVersion muchas veces
let waVersionPromise: Promise<{ version: [number, number, number] }> | null =
  null;

async function getWaVersion() {
  if (!waVersionPromise) {
    waVersionPromise = fetchLatestBaileysVersion().catch((err) => {
      console.error("[baileysManager] Error obteniendo versión WA:", err);
      // fallback a una versión estable conocida
      return { version: [2, 3000, 1027934701] as [number, number, number] };
    });
  }
  return waVersionPromise;
}

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
 * ⚠️ USAR SOLO DESDE:
 *   - /api/admin/whatsapp/connect  (cuando el user hace click en "Conectar")
 *
 * ❌ NO USAR DESDE:
 *   - /status
 *   - ningún polling
 *
 * El status debe leerse SIEMPRE desde la tabla whatsapp_sessions.
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
  //    En Render es disco efímero, pero suficiente para mantener sesión
  //    mientras el proceso está vivo.
  const sessionPath = `./.wa_sessions/${sessionId}`;
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const { version } = await getWaVersion();

  // 3) Crear socket
  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.appropriate("Desktop"),
    printQRInTerminal: false, // el QR lo manejamos via DB + dashboard
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
        "qr? ",
        !!qr
      );

      // 📲 Nuevo QR recibido
      if (qr) {
        info.status = "qrcode";
        info.lastQr = qr;

        try {
          await supabaseAdmin
            .from("whatsapp_sessions")
            .update({
              status: "qrcode",
              qr_data: qr,
              qr_svg: null,
              qr_expires_at: new Date(Date.now() + 60_000), // ~60s
              last_error: null,
            })
            .eq("id", sessionId);
        } catch (e) {
          console.error(
            "[baileysManager] Error actualizando QR en whatsapp_sessions:",
            e
          );
        }
      }

      // ✅ Conectado
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

        try {
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
        } catch (e) {
          console.error(
            "[baileysManager] Error actualizando estado 'connected':",
            e
          );
        }
      }

      // ❌ Cerrado
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

        try {
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
        } catch (e) {
          console.error(
            "[baileysManager] Error actualizando estado 'disconnected':",
            e
          );
        }

        // Si WhatsApp dijo "cerrar sesión en este dispositivo" (loggedOut),
        // NO intentamos reconectar con estas creds → se borra de memoria y
        // tendrás que reconectar desde el panel.
        sessions.delete(k);
      }
    }

    /*********** Credenciales ***********/
    if (events["creds.update"]) {
      try {
        await saveCreds();
      } catch (e) {
        console.error("[baileysManager] Error guardando creds:", e);
      }
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

  try {
    await supabaseAdmin
      .from("whatsapp_sessions")
      .update({
        status: "disconnected",
        qr_data: null,
        qr_svg: null,
        last_seen_at: new Date(),
      })
      .eq("id", sessionId);
  } catch (e) {
    console.error("[baileysManager] Error marcando sesión desconectada:", e);
  }
}
