import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Inicializar cliente Supabase (Service Role para permisos totales)
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

// URL del Bot en Render (Variable de entorno en Vercel/Render)
const WA_URL = process.env.NEXT_PUBLIC_WA_SERVER_URL || "http://localhost:4001";

// --- HELPERS ---

const isUuid = (v?: string | null) =>
  !!v && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(v!);
const isIso = (v?: string | null) => !!v && !Number.isNaN(new Date(v!).getTime());

// Función para enviar mensajes al Bot
async function sendToBot(tenantId: string, event: string, phone: string, vars: any) {
  try {
    // Llamamos a tu servidor de bots para que envíe el mensaje + archivo .ics
    const res = await fetch(`${WA_URL}/sessions/${tenantId}/send-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        phone,
        variables: vars
      }),
    });
    
    if (!res.ok) {
        console.error(`[Bookings API] Error enviando WhatsApp (${event}):`, await res.text());
    }
  } catch (e) {
    console.error("[Bookings API] Error de conexión con Bot:", e);
  }
}

// =====================================================================
// GET: LEER CITAS (Tu código original)
// =====================================================================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId   = searchParams.get("tenantId");
    const resourceId = searchParams.get("resourceId"); // opcional
    const from       = searchParams.get("from");
    const to         = searchParams.get("to");

    if (!isUuid(tenantId)) return NextResponse.json({ error: "tenantId inválido" }, { status: 400 });
    if (!isIso(from) || !isIso(to)) return NextResponse.json({ error: "from/to inválidos" }, { status: 400 });
    if (resourceId && !isUuid(resourceId)) return NextResponse.json({ error: "resourceId inválido" }, { status: 400 });

    const base = () =>
      sb.from("bookings")
        .select("*")
        .gte("starts_at", from!).lt("starts_at", to!)
        .order("starts_at", { ascending: true });

    let q = base().eq("tenant_id", tenantId!); // Probamos nombre estándar primero
    if (resourceId) q = q.eq("resource_id", resourceId);
    
    let { data, error } = await q;

    // Fallback por si las columnas tienen sufijo _uuid
    if (error && (error as any).code === "42703") {
      let q2 = base().eq("tenant_id_uuid", tenantId!);
      if (resourceId) q2 = q2.eq("resource_id_uuid", resourceId);
      ({ data, error } = await q2);
    }

    if (error) {
      return NextResponse.json(
        { error: "query_failed", supabase: error },
        { status: 500 }
      );
    }

    const rows = (data ?? []).map((r: any) => ({
      id: r.id,
      tenant_id: r.tenant_id_uuid ?? r.tenant_id ?? null,
      service_id: r.service_id_uuid ?? r.service_id ?? null,
      resource_id: r.resource_id_uuid ?? r.resource_id ?? null,
      customer_name: r.customer_name ?? null,
      customer_phone: r.customer_phone ?? null,
      status: r.status_booking_status ?? r.status ?? null,
      starts_at: r.starts_at,
      ends_at: r.ends_at,
      notes: r.notes ?? null,
    }));

    return NextResponse.json({ data: rows }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "unexpected_error", detail: String(e?.message || e) }, { status: 500 });
  }
}

// =====================================================================
// POST: CREAR CITA + NOTIFICACIONES (Lo nuevo)
// =====================================================================
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Validar datos mínimos
    if (!body.tenant_id || !body.starts_at || !body.resource_id) {
        return NextResponse.json({ error: "Faltan datos obligatorios" }, { status: 400 });
    }

    // 1. GUARDAR CITA EN LA BASE DE DATOS
    const { data: booking, error } = await sb
      .from("bookings")
      .insert(body)
      .select()
      .single();

    if (error) {
        console.error("Error insertando booking:", error);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    // ---------------------------------------------------------
    // 🔥 LÓGICA DE NOTIFICACIONES DOBLES
    // ---------------------------------------------------------

    // A) Extraer fecha y hora para el mensaje
    // Asumiendo que starts_at es ISO (ej: 2025-12-05T14:00:00)
    const startDate = new Date(booking.starts_at);
    const dateStr = startDate.toLocaleDateString("es-DO");
    const timeStr = startDate.toLocaleTimeString("es-DO", { hour: '2-digit', minute: '2-digit' });

    // B) Buscar datos del Recurso (Barbero/Doctor) para obtener SU TELÉFONO
    const { data: resource } = await sb
      .from("resources")
      .select("name, phone") // Asegúrate que la columna 'phone' ya exista en resources
      .eq("id", booking.resource_id)
      .single();

    const resourceName = resource?.name || "Nosotros";
    const resourcePhone = resource?.phone; // Teléfono del empleado

    // C) NOTIFICACIÓN 1: AL CLIENTE
    if (booking.customer_phone) {
      await sendToBot(booking.tenant_id, "booking_confirmed", booking.customer_phone, {
        customer_name: booking.customer_name || "Cliente",
        date: dateStr,
        time: timeStr,
        resource_name: resourceName,
      });
    }

    // D) NOTIFICACIÓN 2: AL EMPLEADO (Barbero)
    if (resourcePhone) {
      await sendToBot(booking.tenant_id, "staff_notification", resourcePhone, {
        resource_name: resourceName, // "Hola Manolo"
        customer_name: booking.customer_name || "Un Cliente",
        date: dateStr,
        time: timeStr
      });
    }

    return NextResponse.json({ ok: true, booking }, { status: 201 });

  } catch (error: any) {
    console.error("Error en POST booking:", error);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}