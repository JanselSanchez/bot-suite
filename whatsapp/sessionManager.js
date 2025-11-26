// whatsapp/sessionManager.js
const path = require("path");
const fs = require("fs");
const P = require("pino");

// ⚠️ Solo para dev/corporativo, mismo truco que antes
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const logger = P({
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  },
});

// Mapa de sesiones: tenantId -> { sock }
const sessions = new Map();
// tenantId -> QR actual pendiente
const tenantQrs = new Map();

/**
 * Crea (o devuelve si ya existe) una sesión de WhatsApp para un tenant.
 * - Usa una carpeta de credenciales por tenant: ./whatsapp/wa-sessions/{tenantId}
 * - Conecta con Baileys y engancha los eventos básicos.
 */
async function createSession(tenantId, onMessage) {
  if (!tenantId) throw new Error("tenantId es requerido");
  if (sessions.has(tenantId)) {
    return sessions.get(tenantId);
  }

  const baileys = await import("@whiskeysockets/baileys");
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
    baileys;

  const authDir = path.join(__dirname, "wa-sessions", tenantId);
  fs.mkdirSync(authDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: state,
    logger,
  });

  // ---- Eventos de conexión / QR ----
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      tenantQrs.set(tenantId, qr);
      logger.info({ tenantId }, "Nuevo QR generado. Escanéalo con WhatsApp.");
    }

    if (connection === "open") {
      tenantQrs.delete(tenantId);
      logger.info({ tenantId }, "✅ Conectado a WhatsApp.");
    }

    if (connection === "close") {
      const statusCode =
        lastDisconnect?.error?.output?.statusCode ??
        lastDisconnect?.error?.data?.statusCode ??
        lastDisconnect?.error?.data?.code ??
        null;

      const shouldReconnect =
        statusCode && statusCode !== DisconnectReason.loggedOut;

      logger.warn(
        { tenantId, reason: lastDisconnect?.error },
        "❌ Conexión cerrada. ¿Reconnect?",
      );

      if (shouldReconnect) {
        // reintentar misma sesión
        createSession(tenantId, onMessage).catch((err) => {
          logger.error({ tenantId, err }, "Error re-creando sesión");
        });
      } else {
        logger.error(
          { tenantId },
          "Sesión cerrada definitivamente. Si quieres volver a vincular, borra la carpeta wa-sessions del tenant.",
        );
        sessions.delete(tenantId);
        tenantQrs.delete(tenantId);
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // ---- Mensajes entrantes ----
  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages && m.messages[0];
      if (!msg || !msg.message) return;

      const remoteJid = msg.key.remoteJid;
      const isFromMe = msg.key.fromMe;

      if (!remoteJid) return;
      if (remoteJid.endsWith("@status")) return;
      if (remoteJid.endsWith("@g.us")) return; // grupos
      if (isFromMe) return; // mensajes enviados por el propio bot

      const messageContent = msg.message;

      const text =
        messageContent.conversation ||
        messageContent?.extendedTextMessage?.text ||
        messageContent?.ephemeralMessage?.message?.conversation ||
        messageContent?.ephemeralMessage?.message?.extendedTextMessage?.text ||
        "";

      const cleanText = (text || "").trim();
      if (!cleanText) return;

      logger.info(
        { tenantId, from: remoteJid, text: cleanText },
        "📩 Mensaje recibido",
      );

      if (typeof onMessage === "function") {
        await onMessage({
          tenantId,
          remoteJid,
          text: cleanText,
          sock,
        });
      }
    } catch (err) {
      logger.error({ tenantId, err }, "Error en messages.upsert");
    }
  });

  const session = { sock };
  sessions.set(tenantId, session);
  return session;
}

function getSession(tenantId) {
  return sessions.get(tenantId) || null;
}

function getTenantQr(tenantId) {
  return tenantQrs.get(tenantId) || null;
}

function getTenantStatus(tenantId) {
  const session = sessions.get(tenantId);
  const connected = !!session; // simplificado; si existe, asumimos online o reconectando
  return { connected, hasQr: tenantQrs.has(tenantId) };
}

module.exports = {
  createSession,
  getSession,
  getTenantQr,
  getTenantStatus,
  logger,
};
