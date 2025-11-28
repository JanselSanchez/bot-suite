import makeWASocket, { useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

// Estado interno del bot
const state = {
  ready: false,
  qr: null as string | null,
  lastUpdate: new Date().toISOString(),
};

let started = false;

export function getWaStatus() {
  return state;
}

export async function ensureWaClient() {
  if (started) return;
  started = true;

  try {
    const { state: authState, saveCreds } = await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
      logger: pino({ level: "silent" }),
      auth: authState,
      printQRInTerminal: false,
    });

    sock.ev.on("connection.update", (update) => {
      const { qr, connection } = update;

      if (qr) {
        state.qr = qr;
        state.ready = false;
        state.lastUpdate = new Date().toISOString();
      }

      if (connection === "open") {
        state.ready = true;
        state.qr = null;
        state.lastUpdate = new Date().toISOString();
      }

      if (connection === "close") {
        state.ready = false;
        state.lastUpdate = new Date().toISOString();
      }
    });

    sock.ev.on("creds.update", saveCreds);
  } catch (error) {
    console.error("Baileys init error:", error);
  }
}
