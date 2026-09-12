import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { assertE164 } from "@dialix/shared";
import { agents, calls, contacts, organizations, phoneNumbers } from "@dialix/db";
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

export async function registerCallRoutes(app: FastifyInstance) {
  app.get("/api/v1/calls", async (req) => {
    const org = await withOrg(req);
    const q = req.query as { status?: string; direction?: string };
    const rows = await db.select().from(calls).where(eq(calls.organizationId, org.organizationId)).orderBy(desc(calls.createdAt)).limit(200);
    return rows.filter((c) => (!q.status || c.status === q.status) && (!q.direction || c.direction === q.direction));
  });

  app.get("/api/v1/calls/export", async (req, reply) => {
    const org = await withOrg(req);
    const rows = await db.select().from(calls).where(eq(calls.organizationId, org.organizationId));
    const header = "id,direction,status,from,to,durationSeconds,creditsCharged,summary,createdAt";
    const lines = rows.map((r) =>
      [r.id, r.direction, r.status, r.fromNumber, r.toNumber, r.durationSeconds, r.creditsCharged, r.summary, r.createdAt.toISOString()]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    reply.header("Content-Disposition", "attachment; filename=calls.csv");
    return reply.type("text/csv").send([header, ...lines].join("\n"));
  });

  app.get("/api/v1/calls/:id", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const [row] = await db.select().from(calls).where(and(eq(calls.id, id), eq(calls.organizationId, org.organizationId))).limit(1);
    if (!row) return reply.code(404).send({ error: `Call ${id} was not found in this workspace.` });
    return row;
  });

  app.post("/api/v1/calls/outbound", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { agentId: string; fromNumberId: string; toNumber: string; contactId?: string };
    if (!body.agentId) return reply.code(400).send({ error: "Choose an agent before placing the outbound call." });
    if (!body.fromNumberId) return reply.code(400).send({ error: "Choose a from-number (caller ID) before placing the outbound call." });
    if (!body.toNumber) return reply.code(400).send({ error: "Enter the destination phone number in E.164, for example +14155551234." });
    const to = assertE164(body.toNumber);
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, body.agentId), eq(agents.organizationId, org.organizationId))).limit(1);
    const [from] = await db.select().from(phoneNumbers).where(and(eq(phoneNumbers.id, body.fromNumberId), eq(phoneNumbers.organizationId, org.organizationId))).limit(1);
    if (!agent) return reply.code(400).send({ error: "That agent is not in this workspace. Pick an agent from the Agents page." });
    if (!from) return reply.code(400).send({ error: "That from-number is not in this workspace. Provision or import a number first." });
    if (!agent.cartesiaAgentId) {
      return reply.code(400).send({ error: `Agent "${agent.name}" is saved locally only. Add CARTESIA_API_KEY and save the agent again so it can dial.` });
    }
    if (!from.cartesiaNumberId) {
      return reply.code(400).send({ error: `Caller ID ${from.e164} is not provisioned in Cartesia, so Dialix cannot originate this call.` });
    }
    if (body.contactId) {
      const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, body.contactId), eq(contacts.organizationId, org.organizationId))).limit(1);
      if (!contact) return reply.code(400).send({ error: "The selected CRM contact was not found in this workspace." });
      if (!contact.consentAt) return reply.code(400).send({ error: `${contact.firstName || contact.phone} has no TCPA consent on file. Record consent on the Contacts page before dialing.` });
    }
    await reserveForCall({
      organizationId: org.organizationId,
      maxCallDurationMinutes: agent.maxCallDurationMinutes,
      useTelephonyAddon: from.kind === "cartesia",
      description: `Outbound to ${to}`,
    });
    const apiKey = await orgApiKey(org.organizationId);
    const result = await cartesia.createOutboundCall({
      from_number_id: from.cartesiaNumberId,
      agent_id: agent.cartesiaAgentId,
      max_call_duration_minutes: agent.maxCallDurationMinutes,
      outbound_calls: [
        {
          to_number: to,
          metadata: { orgId: org.organizationId, contactId: body.contactId, dialixAgentId: agent.id },
        },
      ],
    }, apiKey);
    const first = result.calls[0];
    const [row] = await db
      .insert(calls)
      .values({
        organizationId: org.organizationId,
        agentId: agent.id,
        phoneNumberId: from.id,
        contactId: body.contactId ?? null,
        cartesiaCallId: first?.agent_call_id ?? null,
        direction: "outbound",
        status: first?.agent_call_id ? "queued" : "failed",
        fromNumber: from.e164,
        toNumber: to,
        metadata: { error: first?.error ?? null },
      })
      .returning();
    await audit(org, "create", "call", row!.id);
    return reply.code(201).send(row);
  });
}
