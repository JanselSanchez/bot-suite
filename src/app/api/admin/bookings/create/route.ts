// src/app/api/admin/bookings/create/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { enqueueWhatsapp } from "@/server/queue";

// 🔹 GET solo para probar en el navegador
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Bookings create API alive. Usa POST para crear reservas.",
  });
}

// 🔹 POST real (lo que ya tienes)
function normalizeWhatsappPhone(phoneRaw: string): string {
  let s = (phoneRaw || "").trim();
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

    const safeName = (customerName || "Cliente").toString();
    const to = normalizeWhatsappPhone(String(phone));

    try {
      await enqueueWhatsapp("booking_created", {
        tenantId,
        to,
        event: "booking_created",
        body: "",
        variables: {
          customerName: safeName,
          businessName: businessName || "tu negocio",
          bookingTime: startsAtISO,
        },
        meta: {
          serviceId,
          resourceId,
          startsAtISO,
          endsAtISO,
          notes: notes || null,
        },
      });
    } catch (e) {
      console.warn(
        "[bookings/create] No se pudo encolar WhatsApp:",
        (e as any)?.message || e
      );
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
