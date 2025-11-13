// src/app/server/queue.ts  (o src/server/queue.ts, donde lo tengas)
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn("[queue] REDIS_URL no está definido. Las colas NO funcionarán.");
}

// Conexión Redis → Redis Cloud
export const redisConnection = redisUrl
  ? new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
  : undefined;

// Cola principal de WhatsApp
export const whatsappQueue = redisConnection
  ? new Queue("whatsapp", {
      // TS sabe que aquí solo entra si redisConnection existe
      connection: redisConnection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
      },
    })
  : null;

// Worker WhatsApp
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

  worker.on("failed", (job, err) => {
    console.error("[queue] Job falló:", job?.id, err);
  });

  worker.on("completed", (job) => {
    console.log("[queue] Job completado:", job?.id);
  });

  return worker;
}
