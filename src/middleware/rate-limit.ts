// Versión sin Redis (Pasarela libre)
// Esto permite que el proyecto compile sin romper las importaciones en otros archivos.

export async function rateLimit(key: string, limit = 60, windowSec = 60) {
  // Como eliminamos Redis, desactivamos el rate limit temporalmente.
  // Devolvemos siempre 'true' (permitido) para no bloquear nada.
  return true;
}