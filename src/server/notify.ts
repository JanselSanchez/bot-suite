import { Queue } from "bullmq";
import IORedis from "ioredis";

const REDIS_URL = process.env.REDIS_URL!;
const useTls = REDIS_URL.startsWith("rediss://");
const connection = new IORedis(REDIS_URL, {
  tls: useTls ? {} : undefined,
  family: 4,
  connectTimeout: 20000,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const q = new Queue("notifications-queue", { connection });

type EventName = "booking_confirmed" | "booking_rescheduled" | "booking_cancelled" | "reminder" | "payment_required";

export async function notifyBookingEvent(args: {
  tenantId: string;
  event: EventName;
  channel?: "whatsapp" | "sms" | "email";
  phone?: string;
  email?: string;
  vars: {
    customer_name?: string;
    startsAt?: string;
    resource_name?: string;
    payment_link?: string;
    date?: string;
    time?: string;
  };
}) {
  const channel = args.channel || "whatsapp";
  await q.add("booking-event", {
    tenantId: args.tenantId,
    event: args.event,
    channel,
    phone: args.phone,
    email: args.email,
    vars: args.vars,
  }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
}
