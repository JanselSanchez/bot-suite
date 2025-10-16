// testTwilio.ts
import "dotenv/config";
import { sendViaTwilio } from "./worker/utils/sendViaTwilio";

async function main() {
  const to = process.argv[2];  // ej: whatsapp:+1829XXXXXXXX
  const body = process.argv.slice(3).join(" ") || "Prueba Twilio ✅";

  if (!to) {
    console.error('Uso: npx tsx testTwilio.ts whatsapp:+1829XXXXXXXX "mensaje"');
    process.exit(1);
  }

  await sendViaTwilio(to, body);
  console.log("Done.");
}

main().catch((e) => {
  console.error("Fallo testTwilio:", e?.message || e);
  process.exit(1);
});
