// src/app/server/whatsapp/baileysManager.ts
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
  } from "@whiskeysockets/baileys";
  import { Boom } from "@hapi/boom";
  import { supabaseAdmin } from "@/app/lib/supabaseAdmin"; // ya lo tienes
  
  type SessionStatus = "disconnected" | "qrcode" | "connecting" | "connected" | "error";
  
  interface SessionInfo {
    socket: WASocket;
    tenantId: string;
    sessionId: string;
    status: SessionStatus;
    lastQr?: string;
  }
  
  const sessions = new Map<string, SessionInfo>(); 
  // key = whatsapp_sessions.id (sessionId)
  
  function key(sessionId: string) {
    return sessionId;
  }
  
  export async function getOrCreateSession(sessionId: string, tenantId: string) {
    const k = key(sessionId);
    const existing = sessions.get(k);
    if (existing) return existing;
  
    // 1) cargar auth_state desde BD
    const { data, error } = await supabaseAdmin
      .from("whatsapp_sessions")
      .select("auth_state")
      .eq("id", sessionId)
      .maybeSingle();
  
    if (error || !data) throw new Error("Session not found");
  
    // Si quieres usar storage en disco, puedes usar useMultiFileAuthState con un path por sessionId
    // Aquí asumo que guardas todo en BD, por lo que tocaría adaptar Baileys a un storage custom.
    // Para dejarte algo funcional rápido: usamos disco y guardamos solo metadata en BD.
  
    const sessionPath = `./.wa_sessions/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  
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
  
    sock.ev.process(async (events) => {
      if (events["connection.update"]) {
        const { connection, lastDisconnect, qr } = events["connection.update"];
  
        if (qr) {
          info.status = "qrcode";
          info.lastQr = qr;
  
          // opcional: generar SVG del QR en backend o lo mandas tal cual "qr" y que el frontend lo pinte
          await supabaseAdmin
            .from("whatsapp_sessions")
            .update({
              status: "qrcode",
              qr_data: qr,
              qr_svg: null, // si generas SVG aquí, lo guardas
              qr_expires_at: new Date(Date.now() + 60_000),
              last_error: null,
            })
            .eq("id", sessionId);
        }
  
        if (connection === "open") {
          info.status = "connected";
  
          await supabaseAdmin
            .from("whatsapp_sessions")
            .update({
              status: "connected",
              qr_data: null,
              qr_svg: null,
              last_connected_at: new Date(),
              last_seen_at: new Date(),
              last_error: null,
            })
            .eq("id", sessionId);
        }
  
        if (connection === "close") {
          const shouldReconnect =
            (lastDisconnect?.error as Boom | undefined)?.output?.statusCode !==
            DisconnectReason.loggedOut;
  
          info.status = "disconnected";
  
          await supabaseAdmin
            .from("whatsapp_sessions")
            .update({
              status: "disconnected",
              last_seen_at: new Date(),
              last_error: lastDisconnect?.error?.toString() ?? null,
            })
            .eq("id", sessionId);
  
          if (!shouldReconnect) {
            sessions.delete(k);
          }
        }
      }
  
      if (events["creds.update"]) {
        await saveCreds();
      }
    });
  
    return info;
  }
  
  export async function disconnectSession(sessionId: string) {
    const s = sessions.get(key(sessionId));
    if (s) {
      await s.socket.logout();
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
  