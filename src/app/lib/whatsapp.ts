export async function sendWhatsApp(to: string, text: string) {
    const provider = process.env.ALERTS_PROVIDER ?? 'meta';
    return provider === 'twilio' ? sendTwilio(to, text) : sendMeta(to, text);
  }
  
  // ----- Meta WhatsApp Cloud -----
  async function sendMeta(to: string, text: string) {
    const token = process.env.META_TOKEN!;
    const phoneId = process.env.META_PHONE_ID!;
    const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: to.replace('whatsapp:', ''),
      type: "text",
      text: { preview_url: false, body: text }
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`Meta send error ${r.status}: ${await r.text()}`);
  }
  
  // ----- Twilio WhatsApp -----
  async function sendTwilio(to: string, text: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_WHATSAPP_FROM!;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ From: from, To: to, Body: text });
  
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });
    if (!r.ok) throw new Error(`Twilio send error ${r.status}: ${await r.text()}`);
  }
  