// src/app/dashboard/reschedule/page.tsx
import { Suspense } from "react";
import ReschedulePageClient from "./ReschedulePageClient";

export default function ReschedulePage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">
          Cargando datos de tu cita…
        </div>
      }
    >
      <ReschedulePageClient />
    </Suspense>
  );
}
