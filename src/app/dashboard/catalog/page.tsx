// src/app/dashboard/catalog/page.tsx
"use client";

import { useState, useEffect, Suspense } from "react"; // 👈 Agregamos Suspense
import { useSearchParams } from "next/navigation"; // 👈 IMPORTANTE: Hook oficial para leer URL
import { createItem, getItems, deleteItem } from "@/app/actions/catalog-actions";
import { Plus, Trash2, Clock, Package } from "lucide-react";

// 1️⃣ COMPONENTE INTERNO: Aquí va TODA tu lógica original
function CatalogContent() {
  // ✅ FORMA ROBUSTA: Usamos el hook para escuchar cambios en la URL en vivo
  const searchParams = useSearchParams();
  const tenantId = searchParams.get("tenantId"); 

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Estado del Formulario
  const [type, setType] = useState<"service" | "product">("service");

  useEffect(() => {
    // Si hay tenantId, cargamos. Si no, limpiamos.
    if (tenantId) {
      loadItems();
    } else {
      setItems([]);
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]); // 👈 Ahora sí reaccionará al cambio del menú

  async function loadItems() {
    if (!tenantId) return;

    setLoading(true);
    try {
      // Pasamos el tenantId (asegurando que es string)
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
    if (!tenantId) return;

    const formData = new FormData(e.currentTarget);
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

  // 🛑 Estado Vacío: Si no seleccionó negocio
  if (!tenantId) {
    return (
      <div className="p-10 max-w-5xl mx-auto text-center border-2 border-dashed border-gray-200 rounded-2xl mt-10">
        <h1 className="text-2xl font-bold text-gray-400">Selecciona un Negocio 👆</h1>
        <p className="text-gray-400 mt-2">
          Usa el menú superior para elegir qué catálogo quieres editar.
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
            ID Negocio: <span className="font-mono bg-gray-100 px-1 rounded">{tenantId}</span>
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-black text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-gray-800 transition shadow-lg"
        >
          <Plus size={20} /> Nuevo Ítem
        </button>
      </div>

      {/* Lista de Ítems */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-3 text-center py-20">
            <p className="text-gray-500 animate-pulse">Cargando productos...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="col-span-3 text-center py-10 bg-gray-50 rounded-xl border border-gray-100">
            <p className="text-gray-500">
              Este negocio no tiene ítems aún. ¡Crea el primero! 🚀
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div
              key={item.id}
              className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm hover:shadow-md transition relative group"
            >
              <div className="flex justify-between items-start mb-2">
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide ${
                    item.type === "service"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {item.type === "service" ? "Servicio" : "Producto"}
                </span>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="text-gray-300 hover:text-red-500 transition p-1"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <h3 className="font-bold text-lg text-gray-800 leading-tight">{item.name}</h3>
              <p className="text-sm text-gray-500 mb-4 mt-1 line-clamp-2 min-h-[40px]">
                {item.description || "Sin descripción"}
              </p>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <span className="text-xl font-bold text-gray-900">
                  RD${(item.price_cents / 100).toFixed(2)}
                </span>

                {item.type === "service" && (
                  <div className="flex items-center text-gray-500 text-xs gap-1 bg-gray-50 px-2 py-1 rounded">
                    <Clock size={14} />
                    <span>{item.duration_minutes} min</span>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL (Sin cambios funcionales, solo visuales) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-2xl font-bold mb-4">Nuevo Ítem</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Selector de TIPO */}
              <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                <button
                  type="button"
                  onClick={() => setType("service")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                    type === "service" ? "bg-white shadow text-black" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Servicio
                </button>
                <button
                  type="button"
                  onClick={() => setType("product")}
                  className={`flex-1 py-2 rounded-md text-sm font-medium transition ${
                    type === "product" ? "bg-white shadow text-black" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Producto
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Nombre</label>
                <input required name="name" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-black focus:outline-none" placeholder="Ej: Corte Premium" />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Descripción (Para la IA)</label>
                <textarea name="description" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-black focus:outline-none" placeholder="Describe los beneficios..." rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Precio (RD$)</label>
                  <input required type="number" name="price" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-black focus:outline-none" placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Categoría</label>
                  <input name="category" className="w-full border border-gray-300 rounded-lg p-2 focus:ring-2 focus:ring-black focus:outline-none" placeholder="Opcional" />
                </div>
              </div>

              {type === "service" && (
                <div className="bg-blue-50 p-3 rounded-lg border border-blue-100">
                  <label className="block text-xs font-bold text-blue-700 uppercase mb-1 flex items-center gap-1">
                    <Clock size={12} /> Duración (Minutos)
                  </label>
                  <input required type="number" name="duration" defaultValue={30} className="w-full border border-blue-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              )}

              <div className="flex gap-3 mt-6 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium">Cancelar</button>
                <button type="submit" className="flex-1 py-2.5 bg-black text-white rounded-lg hover:bg-gray-800 font-medium">Guardar Ítem</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// 2️⃣ COMPONENTE PRINCIPAL: El envoltorio con Suspense para arreglar el error del Build
export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center text-gray-500">Cargando catálogo...</div>}>
      <CatalogContent />
    </Suspense>
  );
}
