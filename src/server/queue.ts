// src/server/queue.ts
import { Queue, Worker, JobsOptions } from "bullmq";
import IORedis, { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn("[queue] REDIS_URL no está definido. Las colas NO funcionarán.");
}

// Conexión Redis → puede ser null si no hay URL
export const redisConnection: Redis | null = redisUrl
  ? new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
  : null;

// Cola principal de WhatsApp
export const whatsappQueue: Queue | null = redisConnection
  ? new Queue("whatsapp", {
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    })
  : null;

/**
 * Encola un mensaje de WhatsApp de forma segura.
 * Si no hay Redis/cola, solo loguea y no rompe el flujo.
 */
export async function enqueueWhatsapp(
  name: string,
  data: Record<string, any>,
  options?: JobsOptions
): Promise<void> {
  if (!whatsappQueue) {
    console.warn(
      "[queue] whatsappQueue no inicializada. Job NO encolado:",
      name,
      data
    );
    return;
  }

  try {
    const job = await whatsappQueue.add(name, data, options);
    console.log("[queue] Job encolado:", job.id, name);
  } catch (error) {
    console.error("[queue] Error encolando job:", name, error);
  }
}

/**
 * Crea un worker para procesar la cola de WhatsApp.
 * Lo usamos en worker/whatsappWorker.ts
 */
export function createWhatsappWorker(
  handler: (job: any) => Promise<any>
) {
  if (!redisConnection) {
    console.warn("[queue] Worker no iniciado porque no hay conexión Redis.");
    return null;
  }

  const worker = new Worker("whatsapp", handler, {
    connection: redisConnection,
    concurrency: 5,
  });

  worker.on("failed", (job, err: Error) => {
    console.error("[queue] Job falló:", job?.id, err);
  });

  worker.on("completed", (job) => {
    console.log("[queue] Job completado:", job?.id);
  });

  return worker;
}
