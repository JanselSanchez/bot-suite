// src/app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1>Bienvenido 👋</h1>
        <p className="text-gray-600">
          Administra tus citas, disponibilidad y clientes. Usa el menú para navegar.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Citas */}
        <Link href="/dashboard/bookings" className="group">
          <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="text-sm font-medium text-gray-500">Módulo</div>
            <div className="mt-1 text-lg font-semibold">Citas</div>
            <p className="mt-1 text-gray-600">Lista, crea y gestiona reservas.</p>
            <div className="mt-3 text-sm text-indigo-600 group-hover:underline">Abrir →</div>
          </div>
        </Link>

        {/* Reprogramar */}
        <Link href="/ui-test/reschedule" className="group">
          <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="text-sm font-medium text-gray-500">Herramienta</div>
            <div className="mt-1 text-lg font-semibold">Reprogramar</div>
            <p className="mt-1 text-gray-600">Mueve citas existentes fácil.</p>
            <div className="mt-3 text-sm text-indigo-600 group-hover:underline">Abrir →</div>
          </div>
        </Link>

        {/* Estado (única tarjeta) */}
        <Link href="/dashboard/status" className="group">
          <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
            <div className="text-sm font-medium text-gray-500">Sistema</div>
            <div className="mt-1 text-lg font-semibold">Estado</div>
            <p className="mt-1 text-gray-600">Ping del backend y credenciales.</p>
            <div className="mt-3 text-sm text-indigo-600 group-hover:underline">Probar →</div>
          </div>
        </Link>
      </section>
    </div>
  );
}
