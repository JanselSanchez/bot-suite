// src/app/dashboard/catalog/page.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { createItem, getItems, deleteItem } from "@/app/actions/catalog-actions";
import { Plus, Trash2, Clock, Package } from "lucide-react";

export default function CatalogPage({
  searchParams,
}: {
  searchParams: { tenantId?: string };
}) {
  // ✅ CORREGIDO: Eliminamos el ID fijo. Ahora obedece estrictamente a la URL.
  // Si searchParams.tenantId no existe, la variable será undefined.
  const tenantId = searchParams?.tenantId;

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Estado del Formulario
  const [type, setType] = useState<"service" | "product">("service");

  useEffect(() => {
    // ✅ Si cambia tenantId (por dropdown), recarga catálogo
    if (tenantId) {
      loadItems();
    } else {
      setItems([]); // Limpia la lista si no hay tenant
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function loadItems() {
    // Doble seguridad: No cargar si no hay ID
    if (!tenantId) return;

    setLoading(true);
    try {
      const data = await getItems(tenantId);
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!tenantId) return; // Seguridad extra

    const formData = new FormData(e.currentTarget);

    // ✅ IMPORTANTÍSIMO: el item se crea en el tenant seleccionado
    formData.append("tenantId", tenantId);
    formData.append("type", type);

    await createItem(formData);
    setIsModalOpen(false);
    await loadItems();
    (e.target as HTMLFormElement).reset();
  }

  async function handleDelete(id: string) {
    if (confirm("¿Estás seguro de borrar este ítem?")) {
      await deleteItem(id);
      await loadItems();
    }
  }

  // ✅ Guardrail real: si no hay tenantId, no intentes cargar
  if (!tenantId) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900">Catálogo Universal</h1>
        <p className="text-gray-500 mt-2">
          Selecciona un negocio arriba para ver su catálogo.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Encabezado */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Catálogo Universal</h1>
          <p className="text-gray-500">Administra tus servicios y productos para el Bot.</p>
          <p className="text-xs text-gray-400 mt-1">
            Tenant activo: <span className="font-mono">{tenantId}</span>
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-black text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-800 transition"
        >
          <Plus size={20} /> Nuevo Ítem
        </button>
      </div>

      {/* Lista de Ítems */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p>Cargando catálogo...</p>
        ) : items.length === 0 ? (
          <p className="text-gray-400 col-span-3 text-center py-10">
            No tienes ítems. Crea el primero para que el bot pueda vender.
          </p>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm hover:shadow-md transition"
            >
              <div className="flex justify-between items-start mb-2">
                <span
                  className={`text-xs font-bold px-2 py-1 rounded-full uppercase tracking-wide ${
                    item.type === "service"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {item.type === "service" ? "Servicio" : "Producto"}
                </span>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <h3 className="font-bold text-lg text-gray-800">{item.name}</h3>
              <p className="text-sm text-gray-500 mb-4 line-clamp-2 h-10">
                {item.description || "Sin descripción"}
              </p>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <span className="text-xl font-bold text-gray-900">
                  RD${(item.price_cents / 100).toFixed(2)}
                </span>

                {item.type === "service" && (
                  <div className="flex items-center text-gray-500 text-sm gap-1">
                    <Clock size={16} />
                    <span>{item.duration_minutes} min</span>
                  </div>
                )}

                {item.type === "product" && (
                  <div className="flex items-center text-gray-500 text-sm gap-1">
                    <Package size={16} />
                    <span>Entrega</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL DE CREACIÓN */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h2 className="text-2xl font-bold mb-4">Nuevo Ítem</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Selector de TIPO */}
              <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                <button
                  type="button"
                  onClick={() => setType("service")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                    type === "service" ? "bg-white shadow text-black" : "text-gray-500"
                  }`}
                >
                  Servicio (Cita)
                </button>
                <button
                  type="button"
                  onClick={() => setType("product")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                    type === "product" ? "bg-white shadow text-black" : "text-gray-500"
                  }`}
                >
                  Producto (Venta)
                </button>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Nombre</label>
                <input
                  required
                  name="name"
                  className="w-full border rounded-lg p-2 mt-1"
                  placeholder="Ej: Corte Degradado / Pizza"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Descripción</label>
                <textarea
                  name="description"
                  className="w-full border rounded-lg p-2 mt-1"
                  placeholder="Detalles para que la IA venda..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Precio (RD$)</label>
                  <input
                    required
                    type="number"
                    name="price"
                    className="w-full border rounded-lg p-2 mt-1"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Categoría</label>
                  <input
                    name="category"
                    className="w-full border rounded-lg p-2 mt-1"
                    placeholder="Ej: Caballeros"
                  />
                </div>
              </div>

              {type === "service" && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <label className="block text-sm font-medium text-blue-800 flex items-center gap-2">
                    <Clock size={16} /> Duración (Minutos)
                  </label>
                  <input
                    required
                    type="number"
                    name="duration"
                    defaultValue={30}
                    className="w-full border rounded-lg p-2 mt-1"
                  />
                  <p className="text-xs text-blue-600 mt-1">
                    Tiempo que se bloqueará en la agenda.
                  </p>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2 border rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-black text-white rounded-lg hover:bg-gray-800"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
