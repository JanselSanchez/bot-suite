import { supabase } from "@/app/lib/superbase";
import { NextRequest, NextResponse } from "next/server";


const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN!;
const META_TOKEN = process.env.META_TOKEN!;
const META_PHONE_ID = process.env.META_PHONE_ID!;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  try {
    const msg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = msg?.from;
    const text: string | undefined = msg?.text?.body?.trim();
    if (!from || !text) return NextResponse.json({ ok: true });

    // Guardar conversación
    const { data: existing } = await supabase
      .from("conversations")
      .select("id")
      .eq("phone", from)
      .limit(1)
      .single();

    let conversationId = existing?.id;
    if (!conversationId) {
      const { data: created } = await supabase
        .from("conversations")
        .insert({ phone: from })
        .select("id")
        .single();
      conversationId = created?.id;
    }

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      role: "user",
      text,
    });

    // Configuración de negocio
    const { data: settings } = await supabase
      .from("business_settings")
      .select("*")
      .eq("id", "default")
      .single();

    const isOpen = checkOpenHours(settings?.open_hour ?? 9, settings?.close_hour ?? 18);
    if (!isOpen) {
      await replyText(from, settings?.after_hours_message ?? "Fuera de horario");
      await saveBotMsg(conversationId!, settings?.after_hours_message ?? "Fuera de horario");
      return NextResponse.json({ ok: true });
    }

    const intent = detectIntent(text, settings?.keywords || []);
    if (intent === "faq") {
      const ans = await faqLookup(text);
      if (ans) {
        await replyText(from, ans);
        await saveBotMsg(conversationId!, ans);
        return NextResponse.json({ ok: true });
      }
    }

    if (["cita", "cotizacion", "precio", "info"].includes(intent)) {
      await supabase.from("leads").insert({ phone: from, intent });
      const msgReply = "Listo 📌 Tomé tus datos. ¿Tu nombre y mejor horario?";
      await replyText(from, msgReply);
      await saveBotMsg(conversationId!, msgReply);
      return NextResponse.json({ ok: true });
    }

    const welcome = settings?.welcome_message ?? "¡Hola! ¿En qué puedo ayudarte?";
    await replyText(from, welcome);
    await saveBotMsg(conversationId!, welcome);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: true });
  }
}

function checkOpenHours(open: number, close: number) {
  const h = new Date().getHours();
  return h >= open && h < close;
}

function detectIntent(text: string, kws: string[]) {
  const t = text.toLowerCase();
  if (kws?.some(k => t.includes(k))) return "cita";
  if (["precio", "coste", "cuesta", "$"].some(k => t.includes(k))) return "precio";
  if (["donde", "ubicación", "ubicacion", "direccion", "mapa", "horario"].some(k => t.includes(k))) return "faq";
  return "faq";
}

async function faqLookup(q: string) {
  const { data: faqs } = await supabase.from("faqs").select("*").eq("active", true);
  const ql = q.toLowerCase();
  let best = { ans: null as string | null, score: 0 };
  for (const f of faqs || []) {
    const s = similarity(ql, f.question.toLowerCase());
    if (s > best.score) best = { ans: f.answer, score: s };
  }
  return best.score > 0.3 ? best.ans : null;
}

function similarity(a: string, b: string) {
  const A = new Set(a.split(/\s+/));
  const B = new Set(b.split(/\s+/));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.max(A.size, B.size);
}

async function replyText(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
}

async function saveBotMsg(conversationId: string, text: string) {
  await supabase.from("messages").insert({ conversation_id: conversationId, role: "bot", text });
}
