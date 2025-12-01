// whatsapp/wa-test.mjs

/************************************************************
 * FIX TLS SOLO PARA ESTA PRUEBA LOCAL
 * (equivalente a lo que ya usas en baileyManager)
 ************************************************************/
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import "dotenv/config";

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

async function main() {
  console.log("[WA-TEST] Iniciando prueba simple de Baileys...");

  // 👇 Carpeta de sesión SOLO para esta prueba
  const sessionPath = "./.wa_sessions_test";
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const { version } = await fetchLatestBaileysVersion();
  console.log("[WA-TEST] Usando versión WA:", version);

  const sock = makeWASocket({
    auth: state,
    version,
    // ⚠️ Ya no confiamos en printQRInTerminal, lo manejamos nosotros
    printQRInTerminal: false,
    browser: ["Desktop", "Chrome", "121.0.0"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.process(async (events) => {
    if (events["connection.update"]) {
      const { connection, lastDisconnect, qr } = events["connection.update"];

      console.log("[WA-TEST][connection.update]", { connection });

      // 👉 Cuando WhatsApp mande un QR, lo pintamos en consola
      if (qr) {
        console.log("\n[WA-TEST] 📲 Escanea este QR desde 'Dispositivos vinculados':\n");
        qrcode.generate(qr, { small: true });
        console.log("\n");
      }

      if (connection === "open") {
        console.log("✅ [WA-TEST] CONECTADO correctamente.");
      }

      if (connection === "close") {
        const statusCode =
          lastDisconnect?.error?.output?.statusCode ??
          lastDisconnect?.error?.data?.statusCode ??
          undefined;

        console.log("[WA-TEST] ❌ CERRADO, statusCode:", statusCode);

        if (statusCode === DisconnectReason.loggedOut) {
          console.log(
            "[WA-TEST] Sesión cerrada desde el teléfono / invalidada. " +
              "Borra la carpeta .wa_sessions_test y vuelve a escanear."
          );
        }
      }
    }

    if (events["creds.update"]) {
      await saveCreds();
    }
  });
}

main().catch((err) => {
  console.error("[WA-TEST] Error fatal:", err);
});
