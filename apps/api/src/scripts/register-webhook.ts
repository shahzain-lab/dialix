import { env } from "../env.js";
import { attachWebhookToAgents, cartesiaWebhookUrl, ensureCartesiaWebhook } from "../services/webhooks.js";

const id = await ensureCartesiaWebhook();
if (!id) {
  console.error("Webhook was not created. Need CARTESIA_API_KEY, CARTESIA_WEBHOOK_SECRET, and an https CARTESIA_WEBHOOK_URL.");
  process.exit(1);
}
const attached = await attachWebhookToAgents(id);
console.log(JSON.stringify({ webhookId: id, url: cartesiaWebhookUrl(), attachedAgents: attached }));
