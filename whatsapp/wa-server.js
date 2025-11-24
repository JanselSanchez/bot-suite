// whatsapp/wa-server.js
require("dotenv").config();
const qrcode = require("qrcode-terminal");
const express = require("express");
const P = require("pino");

// ⚠️ Solo para entorno corporativo / dev:
// ignora certificados self-signed (arregla SELF_SIGNED_CERT_IN_CHAIN)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const app = express();
const PORT = process.env.WA_SERVER_PORT || 4001;

let lastQr = null;
let sock;

// Logger bonito
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

// --------- Inicializar Baileys ---------
async function startWhatsApp() {
  // Import dinámico porque Baileys es ESM
  const baileys = await import("@whiskeysockets/baileys");
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } =
    baileys;

  const { state, saveCreds } = await useMultiFileAuthState("./whatsapp_auth");

  sock = makeWASocket({
    auth: state,
    // printQRInTerminal está deprecado, lo manejamos con connection.update
    logger,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      lastQr = qr;
      logger.info("Nuevo QR generado. Escanéalo con WhatsApp.");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      lastQr = null;
      logger.info("✅ Conectado a WhatsApp.");
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;

      logger.warn(
        { reason: lastDisconnect?.error },
        "❌ Conexión cerrada. ¿Reconnect?",
      );

      if (shouldReconnect) {
        startWhatsApp();
      } else {
        logger.error(
          "Sesión cerrada definitivamente. Borra la carpeta whatsapp_auth si quieres volver a vincular.",
        );
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);

  // Mensajes entrantes
  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages && m.messages[0];
      if (!msg || !msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const content =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message?.ephemeralMessage?.message?.conversation ||
        "";

      logger.info({ from: remoteJid, text: content }, "📩 Mensaje recibido");

      if (!content) return;

      // 🔥 Aquí luego conectamos la IA.
      const reply =
        `Hola 👋, recibí tu mensaje:\n\n"${content}"\n\n` +
        "Estoy en modo demo con Baileys.";
      await sock.sendMessage(remoteJid, { text: reply });

      logger.info({ to: remoteJid, reply }, "📤 Respuesta enviada");
    } catch (err) {
      logger.error({ err }, "Error en messages.upsert");
    }
  });
}

// --------- API HTTP (para QR y estado) ---------
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "wa-server", connected: !!sock });
});

app.get("/qr", (_req, res) => {
  if (lastQr) {
    return res.json({ ok: true, qr: lastQr });
  }
  return res.json({
    ok: !lastQr && !!sock,
    qr: null,
    message: sock ? "Conectado, no hay QR pendiente" : "Inicializando...",
  });
});

// Iniciar servidor HTTP + WhatsApp
app.listen(PORT, () => {
  logger.info(`🚀 WA server escuchando en http://localhost:${PORT}`);
  startWhatsApp().catch((err) => {
    logger.error({ err }, "Error inicializando WhatsApp");
  });
});
