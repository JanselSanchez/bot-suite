import IORedis from 'ioredis'
const redis = new IORedis(process.env.REDIS_URL!)

export async function rateLimit(key: string, limit = 60, windowSec = 60) {
  const k = `rl:${key}`
  const tx = redis.multi()
  tx.incr(k)
  tx.expire(k, windowSec)
  const [count] = (await tx.exec()) as any[]
  return Number(count[1]) <= limit
}
