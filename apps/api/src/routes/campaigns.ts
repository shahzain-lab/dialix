import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { campaignSchema, CAMPAIGN_REGIONS } from "@dialix/shared";
import { agents, campaignRecipients, campaigns, contactListMembers, contacts, organizations, phoneNumbers } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { decryptSecret } from "../crypto.js";
import { reserveForCall } from "../services/credits.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

export async function registerCampaignRoutes(app: FastifyInstance) {
  app.get("/api/v1/campaigns", async (req) => {
    const org = await withOrg(req);
    const rows = await db.select().from(campaigns).where(eq(campaigns.organizationId, org.organizationId));
    const withCounts = [];
    for (const campaign of rows) {
      const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, campaign.id));
      withCounts.push({
        ...campaign,
        recipientCount: recipients.length,
        consentedCount: recipients.filter((r) => r.status !== "blocked_no_consent").length,
      });
    }
    return withCounts;
  });

  app.get("/api/v1/campaigns/options", async (req) => {
    await withOrg(req);
    return {
      regions: CAMPAIGN_REGIONS,
      concurrency: { min: 1, max: 50, default: 5 },
      ringingTimeoutSeconds: { min: 5, max: 120, default: 30 },
      maxCallDurationMinutes: { min: 1, max: 60, default: 10 },
      actions: ["create", "schedule", "start", "retry", "cancel"],
    };
  });

  app.get("/api/v1/campaigns/:id", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.organizationId, org.organizationId)))
      .limit(1);
    if (!campaign) return reply.code(404).send({ error: `Campaign ${id} was not found in this workspace.` });
    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    const apiKey = await orgApiKey(org.organizationId);
    let batch: unknown = null;
    if (campaign.cartesiaBatchId && (cartesia.configured() || apiKey)) {
      batch = await cartesia.getCallBatch(campaign.cartesiaBatchId, apiKey).catch(() => null);
    }
    return { ...campaign, recipients, batch };
  });

  app.post("/api/v1/campaigns", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = campaignSchema.parse(req.body);
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, parsed.agentId), eq(agents.organizationId, org.organizationId)))
      .limit(1);
    const [from] = await db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.id, parsed.fromNumberId), eq(phoneNumbers.organizationId, org.organizationId)))
      .limit(1);
    if (!agent) return reply.code(400).send({ error: "Choose an agent that belongs to this workspace." });
    if (!from) return reply.code(400).send({ error: "Choose a from-number that belongs to this workspace." });
    const [campaign] = await db
      .insert(campaigns)
      .values({
        organizationId: org.organizationId,
        agentId: parsed.agentId,
        fromNumberId: parsed.fromNumberId,
        listId: parsed.listId ?? null,
        name: parsed.name,
        status: parsed.scheduledAt ? "scheduled" : "draft",
        targetConcurrency: parsed.targetConcurrency,
        scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : null,
        settings: {
          region: parsed.region ?? "US",
          ringingTimeoutSeconds: parsed.ringingTimeoutSeconds ?? null,
          maxCallDurationMinutes: parsed.maxCallDurationMinutes ?? null,
        },
      })
      .returning();
    let contactRows = [] as typeof contacts.$inferSelect[];
    if (parsed.listId) {
      const members = await db.select().from(contactListMembers).where(eq(contactListMembers.listId, parsed.listId));
      const all = await db.select().from(contacts).where(eq(contacts.organizationId, org.organizationId));
      contactRows = all.filter((c) => members.some((m) => m.contactId === c.id));
    } else if (parsed.contactIds?.length) {
      const all = await db.select().from(contacts).where(eq(contacts.organizationId, org.organizationId));
      contactRows = all.filter((c) => parsed.contactIds!.includes(c.id));
    }
    for (const contact of contactRows) {
      await db.insert(campaignRecipients).values({
        organizationId: org.organizationId,
        campaignId: campaign!.id,
        contactId: contact.id,
        toNumber: contact.phone,
      });
    }
    await audit(org, "create", "campaign", campaign!.id);
    return reply.code(201).send(campaign);
  });

  app.post("/api/v1/campaigns/:id/start", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), eq(campaigns.organizationId, org.organizationId)))
      .limit(1);
    if (!campaign) return reply.code(404).send({ error: `Campaign ${id} was not found in this workspace.` });
    const [agent] = await db.select().from(agents).where(eq(agents.id, campaign.agentId)).limit(1);
    const [from] = await db.select().from(phoneNumbers).where(eq(phoneNumbers.id, campaign.fromNumberId)).limit(1);
    const recipients = await db.select().from(campaignRecipients).where(eq(campaignRecipients.campaignId, id));
    const allowed = [];
    for (const recipient of recipients) {
      const [contact] = recipient.contactId
        ? await db.select().from(contacts).where(eq(contacts.id, recipient.contactId)).limit(1)
        : [];
      if (!contact?.consentAt) {
        await db.update(campaignRecipients).set({ status: "blocked_no_consent", errorMessage: "TCPA consent required" }).where(eq(campaignRecipients.id, recipient.id));
        continue;
      }
      allowed.push(recipient);
    }
    if (!allowed.length) {
      return reply.code(400).send({
        error: `Campaign "${campaign.name}" has ${recipients.length} recipient(s) but none have TCPA consent. Mark consent on Contacts, then start again.`,
      });
    }
    if (!agent?.cartesiaAgentId) {
      return reply.code(400).send({ error: `Agent "${agent?.name ?? campaign.agentId}" is not synced to Cartesia. Save it with CARTESIA_API_KEY, then retry.` });
    }
    if (!from?.cartesiaNumberId) {
      return reply.code(400).send({ error: "The campaign from-number is not provisioned in Cartesia, so the batch cannot originate." });
    }
    await reserveForCall({
      organizationId: org.organizationId,
      maxCallDurationMinutes: agent.maxCallDurationMinutes,
      useTelephonyAddon: from.kind === "cartesia",
      description: `Campaign ${campaign.name} reservation`,
    });
    const apiKey = await orgApiKey(org.organizationId);
    const settings = campaign.settings ?? {};
    const batchPayload: Record<string, unknown> = {
      name: campaign.name,
      from_number_id: from.cartesiaNumberId,
      agent_id: agent.cartesiaAgentId,
      target_concurrency_limit: campaign.targetConcurrency,
      region: settings.region ?? "US",
      scheduled_at: campaign.scheduledAt && campaign.scheduledAt > new Date() ? campaign.scheduledAt.toISOString() : undefined,
      recipients: allowed.map((r) => ({
        to_number: r.toNumber,
        metadata: { orgId: org.organizationId, campaignId: campaign.id, contactId: r.contactId, dialixCampaignRecipientId: r.id },
      })),
    };
    if (settings.ringingTimeoutSeconds) batchPayload.ringing_timeout_seconds = settings.ringingTimeoutSeconds;
    if (settings.maxCallDurationMinutes) batchPayload.max_call_duration_minutes = settings.maxCallDurationMinutes;
    const batch = await cartesia.createCallBatch(batchPayload, apiKey);
    await db.update(campaigns).set({ status: "running", cartesiaBatchId: batch.id, updatedAt: new Date() }).where(eq(campaigns.id, id));
    await audit(org, "start", "campaign", id);
    return { ...campaign, status: "running", cartesiaBatchId: batch.id };
  });

  app.post("/api/v1/campaigns/:id/retry", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.organizationId, org.organizationId))).limit(1);
    if (!campaign) return reply.code(404).send({ error: `Campaign ${id} was not found in this workspace.` });
    if (!campaign.cartesiaBatchId) return reply.code(400).send({ error: `Campaign "${campaign.name}" has not been started, so there is no Cartesia batch to retry.` });
    const apiKey = await orgApiKey(org.organizationId);
    await cartesia.retryCallBatch(campaign.cartesiaBatchId, apiKey);
    return { ok: true };
  });

  app.post("/api/v1/campaigns/:id/cancel", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [campaign] = await db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.organizationId, org.organizationId))).limit(1);
    if (!campaign) return reply.code(404).send({ error: `Campaign ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (campaign.cartesiaBatchId) await cartesia.cancelCallBatch(campaign.cartesiaBatchId, apiKey).catch(() => undefined);
    await db.update(campaigns).set({ status: "canceled", updatedAt: new Date() }).where(eq(campaigns.id, id));
    return { ok: true };
  });
}
