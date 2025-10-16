"use client";
import RescheduleDialog from "@/app/dashboard/bookings/RescheduleDialog";
import { useEffect, useState } from "react";

type Booking = {
  id: string;
  tenant_id: string;
  service_id: string;
  starts_at: string;
  resource_id: string | null;
};

export default function UITestReschedule() {
  const [open, setOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [bk, setBk] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadBooking() {
    if (!bookingId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}`);
      const j = await res.json();
      if (!j?.data) throw new Error("No encontrada");
      setBk(j.data);
      setOpen(true);
    } catch (e:any) {
      alert(e.message || "No pude cargar la cita");
      setBk(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">UI Test · Reprogramar</h1>
      <div className="flex gap-2">
        <input
          className="border rounded px-3 py-2 w-96"
          placeholder="booking_id (UUID)"
          value={bookingId}
          onChange={(e) => setBookingId(e.target.value)}
        />
        <button
          onClick={loadBooking}
          disabled={!bookingId || loading}
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
        >
          {loading ? "Cargando..." : "Abrir diálogo"}
        </button>
      </div>

      {bk && (
        <RescheduleDialog
          open={open}
          onOpenChange={setOpen}
          booking={bk}
        />
      )}
    </div>
  );
}
