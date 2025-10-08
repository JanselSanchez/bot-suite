import IORedis from "ioredis";
const redis = new IORedis(process.env.REDIS_URL!);
redis.ping().then((res) => {
  console.log("✅ Redis responde:", res);
  redis.disconnect();
});
