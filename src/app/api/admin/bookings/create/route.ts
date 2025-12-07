// src/app/api/admin/bookings/create/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
// ❌ ELIMINADO: import { enqueueWhatsapp } from "@/server/queue";

// 🔹 GET solo para probar en el navegador
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Bookings create API alive. Usa POST para crear reservas.",
  });
}

// 🔹 POST real
function normalizeWhatsappPhone(phoneRaw: string): string {
  const s = (phoneRaw || "").trim();
  if (!s) return s;

  if (s.toLowerCase().startsWith("whatsapp:")) return s;

  const cleaned = s.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("+")) return `whatsapp:${cleaned}`;

  if (/^\d{10}$/.test(cleaned)) {
    return `whatsapp:+1${cleaned}`;
  }

  return `whatsapp:${cleaned}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const {
      tenantId,
      phone,
      customerName,
      serviceId,
      resourceId,
      startsAtISO,
      endsAtISO,
      notes,
      businessName,
    } = body || {};

    if (
      !tenantId ||
      !phone ||
      !serviceId ||
      !resourceId ||
      !startsAtISO ||
      !endsAtISO
    ) {
      return NextResponse.json(
        { ok: false, error: "missing_fields" },
        { status: 400 }
      );
    }

    // 1. Crear Reserva en DB
    const { data, error } = await supabaseAdmin.rpc("book_slot_safe_phone", {
      p_tenant: tenantId,
      p_phone: phone,
      p_service: serviceId,
      p_resource: resourceId,
      p_starts: startsAtISO,
      p_ends: endsAtISO,
      p_customer_name: customerName || "Cliente",
      p_notes: notes || null,
    });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 }
      );
    }

    // 2. Notificar vía WhatsApp (Directo, sin Redis)
    const safeName = (customerName || "Cliente").toString();
    const to = normalizeWhatsappPhone(String(phone));

    try {
      // Intentamos contactar al bot que corre localmente en el puerto 4001
      // Si tienes WA_SERVER_URL en variables de entorno lo usa, si no, usa localhost
      const waServerUrl = process.env.WA_SERVER_URL || "http://localhost:4001";
      
      // Parseamos fecha y hora simple para la plantilla
      const dateObj = new Date(startsAtISO);
      const dateStr = dateObj.toLocaleDateString("es-DO");
      const timeStr = dateObj.toLocaleTimeString("es-DO", { hour: '2-digit', minute: '2-digit' });

      await fetch(`${waServerUrl}/sessions/${tenantId}/send-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: to,
          event: "booking_created",
          variables: {
            customerName: safeName,
            businessName: businessName || "tu negocio",
            date: dateStr,
            time: timeStr
          }
        }),
      });
      
    } catch (e) {
      // Solo advertencia, no fallamos la creación de la cita si el mensaje falla
      console.warn("[bookings/create] No se pudo enviar WhatsApp directo:", e);
    }

    return NextResponse.json({ ok: true, data }, { status: 200 });
  } catch (e: any) {
    console.error("[bookings/create] unexpected error:", e);
    return NextResponse.json(
      {
        ok: false,
        error: "unexpected_error",
        detail: String(e?.message || e),
      },
      { status: 500 }
    );
  }
}