// src/server/queue.ts
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

const url = process.env.REDIS_URL!;
if (!url) throw new Error('Falta REDIS_URL');

const useTls = url.startsWith('rediss://');

export const connection = new IORedis(url, {
  tls: useTls ? {} : undefined,
  family: 4,
  connectTimeout: 20000,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    return Math.min(1000 * Math.pow(2, times), 10000);
  },
});

export const chatQueue = new Queue('chat-queue', { connection });
