import { env } from "../env.js";
import { cartesia } from "../integrations/cartesia/client.js";

let cachedId: string | null = env.CARTESIA_WEBHOOK_ID || null;

export function cartesiaWebhookUrl() {
  const explicit = env.CARTESIA_WEBHOOK_URL.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return `${env.PUBLIC_API_URL.replace(/\/$/, "")}/internal/cartesia/events`;
}

export async function ensureCartesiaWebhook(apiKey?: string) {
  if (cachedId) return cachedId;
  if (!cartesia.configured() && !apiKey) return null;
  if (!env.CARTESIA_WEBHOOK_SECRET) return null;
  const url = cartesiaWebhookUrl();
  if (!url.startsWith("https://")) return null;
  const listed = await cartesia.listWebhooks(apiKey).catch(() => ({ data: [] as Array<{ id: string; url: string }> }));
  const rows = listed.data ?? [];
  const existing = rows.find((row) => row.url === url);
  if (existing) {
    cachedId = existing.id;
    return cachedId;
  }
  const created = await cartesia.createWebhook(url, env.CARTESIA_WEBHOOK_SECRET, apiKey);
  cachedId = created.id;
  return cachedId;
}

export async function attachWebhookToAgents(webhookId: string, apiKey?: string) {
  const listed = await cartesia.listAgents(apiKey).catch(() => ({ data: [] as Array<{ id: string }> }));
  const agents = listed.data ?? [];
  for (const agent of agents) {
    if (!agent?.id) continue;
    await cartesia.attachCallWebhook(agent.id, webhookId, apiKey).catch(() => undefined);
  }
  return agents.length;
}
