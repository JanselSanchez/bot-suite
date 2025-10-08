// worker/utils/normalizer.ts
export function normalize(input: string): string {
    if (!input) return "";
    let s = input.toLowerCase();
  
    // quita tildes
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
    // reemplazos rápidos dominicanos / errores comunes
    const repl: Record<string, string> = {
      " pa' ": " para ",
      " pa ": " para ",
      " pa": " para",
      sita: "cita",
      reserba: "reservar",
      reselvar: "reservar",
      rerservar: "reservar",
      ajendar: "agendar",
      agendarme: "agendar",
      "bookear": "reservar",
    };
  
    // bordes de palabra
    for (const [k, v] of Object.entries(repl)) {
      const re = new RegExp(`\\b${escapeRegExp(k)}\\b`, "g");
      s = s.replace(re, v);
    }
  
    // quitar puntuación "pesada"
    s = s.replace(/[^\p{L}\p{N}\s:]/gu, " ");
  
    // colapsa espacios
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }
  
  function escapeRegExp(x: string) {
    return x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  