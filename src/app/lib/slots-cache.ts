import IORedis from 'ioredis'; const redis = new IORedis(process.env.REDIS_URL!)
const TTL = 300 // 5 min

export async function getCachedSlots(key: string) {
  const raw = await redis.get(key); return raw ? JSON.parse(raw) : null
}
export async function setCachedSlots(key: string, value: unknown) {
  await redis.set(key, JSON.stringify(value), 'EX', TTL)
}
export async function invalidateSlots(tenant: string, resource: string, isoDate: string) {
  const key = `slots:${tenant}:${resource}:${isoDate}`; await redis.del(key)
}
