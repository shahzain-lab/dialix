import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { sipProviderSchema, twilioProviderSchema } from "@dialix/shared";
import { agents, organizations, phoneNumbers, telephonyProviders } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { decryptSecret, encryptSecret } from "../crypto.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

export async function registerPhoneRoutes(app: FastifyInstance) {
  app.get("/api/v1/phone-numbers", async (req) => {
    const org = await withOrg(req);
    return db.select().from(phoneNumbers).where(eq(phoneNumbers.organizationId, org.organizationId));
  });

  app.get("/api/v1/telephony-providers", async (req) => {
    const org = await withOrg(req);
    const rows = await db.select().from(telephonyProviders).where(eq(telephonyProviders.organizationId, org.organizationId));
    return rows.map((r) => ({ ...r, credentialsEncrypted: undefined }));
  });

  app.post("/api/v1/phone-numbers/provision", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { label: string; agentId?: string };
    const apiKey = await orgApiKey(org.organizationId);
    if (!cartesia.configured() && !apiKey) {
      return reply.code(503).send({ error: "Cartesia is not connected. Add CARTESIA_API_KEY to provision a US number." });
    }
    let cartesiaAgentId: string | undefined;
    if (body.agentId) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, body.agentId), eq(agents.organizationId, org.organizationId)))
        .limit(1);
      cartesiaAgentId = agent?.cartesiaAgentId ?? undefined;
    }
    const created = await cartesia.provisionNumber(body.label, cartesiaAgentId, apiKey);
    const [row] = await db
      .insert(phoneNumbers)
      .values({
        organizationId: org.organizationId,
        agentId: body.agentId ?? null,
        cartesiaNumberId: created.id,
        e164: created.number,
        label: body.label,
        kind: "cartesia",
      })
      .returning();
    await audit(org, "create", "phone_number", row!.id);
    return reply.code(201).send(row);
  });

  app.post("/api/v1/telephony-providers/twilio", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = twilioProviderSchema.parse(req.body);
    const apiKey = await orgApiKey(org.organizationId);
    const created = await cartesia.createProvider(
      {
        type: "twilio",
        account_sid: parsed.accountSid,
        api_key_sid: parsed.apiKeySid,
        api_key_secret: parsed.apiKeySecret,
        region: parsed.region,
      },
      apiKey,
    );
    const [row] = await db
      .insert(telephonyProviders)
      .values({
        organizationId: org.organizationId,
        kind: "twilio",
        label: parsed.label,
        cartesiaProviderId: created.id,
        credentialsEncrypted: encryptSecret(JSON.stringify(parsed)),
        config: { region: parsed.region },
      })
      .returning();
    await audit(org, "create", "telephony_provider", row!.id);
    return reply.code(201).send({ ...row, credentialsEncrypted: undefined });
  });

  app.post("/api/v1/telephony-providers/sip", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = sipProviderSchema.parse(req.body);
    const apiKey = await orgApiKey(org.organizationId);
    const created = await cartesia.createProvider(
      {
        type: "sip_trunk",
        label: parsed.label,
        inbound: parsed.inboundUsername
          ? { credentials: { username: parsed.inboundUsername, password: parsed.inboundPassword }, media_encryption: parsed.mediaEncryption }
          : undefined,
        outbound: {
          address: parsed.outboundAddress,
          transport: parsed.outboundTransport,
          destination_country: parsed.destinationCountry,
          media_encryption: parsed.mediaEncryption,
          credentials: parsed.outboundUsername
            ? { username: parsed.outboundUsername, password: parsed.outboundPassword }
            : undefined,
        },
      },
      apiKey,
    );
    const [row] = await db
      .insert(telephonyProviders)
      .values({
        organizationId: org.organizationId,
        kind: "sip_trunk",
        label: parsed.label,
        cartesiaProviderId: created.id,
        credentialsEncrypted: encryptSecret(JSON.stringify(parsed)),
        config: { outboundAddress: parsed.outboundAddress },
      })
      .returning();
    await audit(org, "create", "telephony_provider", row!.id);
    return reply.code(201).send({ ...row, credentialsEncrypted: undefined });
  });

  app.post("/api/v1/phone-numbers/import", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { label: string; number: string; providerId: string; agentId?: string };
    const [provider] = await db
      .select()
      .from(telephonyProviders)
      .where(and(eq(telephonyProviders.id, body.providerId), eq(telephonyProviders.organizationId, org.organizationId)))
      .limit(1);
    if (!provider) return reply.code(400).send({ error: "Select a Twilio or SIP provider that belongs to this workspace before importing a number." });
    if (!provider.cartesiaProviderId) {
      return reply.code(400).send({ error: `Provider "${provider.label}" is not registered in Cartesia, so the number cannot be imported.` });
    }
    const apiKey = await orgApiKey(org.organizationId);
    const created = await cartesia.importNumber(
      {
        label: body.label,
        number: body.number,
        provider: { id: provider.cartesiaProviderId },
        agent_id: undefined,
      },
      apiKey,
    );
    const [row] = await db
      .insert(phoneNumbers)
      .values({
        organizationId: org.organizationId,
        providerId: provider.id,
        agentId: body.agentId ?? null,
        cartesiaNumberId: created.id,
        e164: created.number ?? body.number,
        label: body.label,
        kind: provider.kind,
      })
      .returning();
    await audit(org, "create", "phone_number", row!.id);
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/phone-numbers/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { agentId?: string | null; label?: string };
    const [existing] = await db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Phone number ${id} was not found in this workspace.` });
    let cartesiaAgentId: string | null = null;
    if (body.agentId) {
      const [agent] = await db
        .select()
        .from(agents)
        .where(and(eq(agents.id, body.agentId), eq(agents.organizationId, org.organizationId)))
        .limit(1);
      cartesiaAgentId = agent?.cartesiaAgentId ?? null;
    }
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaNumberId) {
      await cartesia.assignNumber(existing.cartesiaNumberId, cartesiaAgentId, apiKey).catch(() => undefined);
    }
    const [row] = await db
      .update(phoneNumbers)
      .set({
        agentId: body.agentId === undefined ? existing.agentId : body.agentId,
        label: body.label ?? existing.label,
        updatedAt: new Date(),
      })
      .where(eq(phoneNumbers.id, id))
      .returning();
    return row;
  });

  app.delete("/api/v1/phone-numbers/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.id, id), eq(phoneNumbers.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Phone number ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaNumberId) {
      await cartesia.assignNumber(existing.cartesiaNumberId, null, apiKey).catch(() => undefined);
      await cartesia.deleteNumber(existing.cartesiaNumberId, apiKey).catch(() => undefined);
    }
    await db.delete(phoneNumbers).where(eq(phoneNumbers.id, id));
    await audit(org, "delete", "phone_number", id);
    return { ok: true };
  });
}
