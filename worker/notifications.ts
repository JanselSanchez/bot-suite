import { Queue, Worker, JobsOptions } from 'bullmq';
import IORedis from 'ioredis';
import { Sentry } from '../sentry.worker';

const connection = new IORedis(process.env.REDIS_URL!);
const queueName = 'notifications';

const worker = new Worker(queueName, async (job) => {
  try {
    // ... tu lógica de envío WhatsApp / SMS ...
  } catch (err) {
    Sentry.captureException(err);
    throw err; // deja que BullMQ reintente
  }
}, { connection });

// (Opcional) más telemetría
worker.on('failed', (job, err) => {
  Sentry.captureException(err, { extra: { jobId: job?.id, name: job?.name } });
});
