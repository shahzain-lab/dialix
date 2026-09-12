import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { agents, appointments, calls, contacts, organizations, phoneNumbers, webhookEvents } from "@dialix/db";
import { secondsFromDuration } from "@dialix/shared";
import { env } from "../env.js";
import { db } from "../db.js";
import { settleCall, reserveForCall } from "../services/credits.js";
import { getCalendarConnector, getCrmConnector } from "../integrations/connectors.js";
import { enqueueCrmSync } from "../queue.js";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function resolveOrg(payload: Record<string, unknown>) {
  const call = (payload.call ?? payload) as Record<string, unknown>;
  const metadata = (call.metadata ?? payload.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.orgId === "string") {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, metadata.orgId)).limit(1);
    if (org) return { org, metadata, call };
  }
  const agentId = String(call.agent_id ?? "");
  if (agentId) {
    const [agent] = await db.select().from(agents).where(eq(agents.cartesiaAgentId, agentId)).limit(1);
    if (agent) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, agent.organizationId)).limit(1);
      if (org) return { org, metadata, call, agent };
    }
  }
  return null;
}

export async function registerInternalRoutes(app: FastifyInstance) {
  app.post("/internal/cartesia/events", async (req, reply) => {
    const secret = req.headers["x-webhook-secret"];
    if (env.CARTESIA_WEBHOOK_SECRET && (typeof secret !== "string" || !timingSafeEqual(secret, env.CARTESIA_WEBHOOK_SECRET))) {
      return reply.code(401).send({ error: "Invalid webhook secret" });
    }
    const payload = req.body as Record<string, unknown>;
    const eventId = String(payload.webhook_request_id ?? payload.id ?? crypto.randomUUID());
    const eventType = String(payload.event ?? payload.type ?? "unknown");
    await db.insert(webhookEvents).values({ source: "cartesia", eventId, eventType, payload }).onConflictDoNothing();
    const resolved = await resolveOrg(payload);
    if (!resolved?.org) return { ok: true, ignored: true };
    const { org, call, metadata } = resolved;
    const cartesiaCallId = String(call.id ?? call.agent_call_id ?? "");
    const telephony = (call.telephony_params ?? {}) as Record<string, string>;
    const statusMap: Record<string, "started" | "completed" | "failed"> = {
      call_started: "started",
      call_completed: "completed",
      call_failed: "failed",
    };
    const status = statusMap[eventType] ?? undefined;
    const [existing] = cartesiaCallId
      ? await db.select().from(calls).where(eq(calls.cartesiaCallId, cartesiaCallId)).limit(1)
      : [];
    const agent = resolved.agent ?? (await db.select().from(agents).where(eq(agents.cartesiaAgentId, String(call.agent_id ?? ""))).then((r) => r[0]));
    const fromNumber = telephony.from ?? existing?.fromNumber;
    const toNumber = telephony.to ?? existing?.toNumber;
    const [number] = fromNumber
      ? await db.select().from(phoneNumbers).where(eq(phoneNumbers.e164, fromNumber)).limit(1)
      : [];
    const startTime = call.start_time ? new Date(String(call.start_time)) : existing?.startTime;
    const endTime = call.end_time ? new Date(String(call.end_time)) : existing?.endTime;
    const duration = secondsFromDuration(startTime, endTime);
    const useTelephony = String(call.telephony_account_type ?? "") === "cartesia";
    if (eventType === "call_started" && cartesiaCallId && agent) {
      await reserveForCall({
        organizationId: org.id,
        cartesiaCallId,
        maxCallDurationMinutes: agent.maxCallDurationMinutes,
        useTelephonyAddon: useTelephony,
        description: "Inbound/outbound call start",
      }).catch(() => undefined);
    }
    let creditsCharged = existing?.creditsCharged ?? 0;
    if ((eventType === "call_completed" || eventType === "call_failed") && cartesiaCallId) {
      creditsCharged = (await settleCall({
        organizationId: org.id,
        cartesiaCallId,
        durationSeconds: duration,
        useTelephonyAddon: useTelephony,
      })) ?? 0;
    }
    const values = {
      organizationId: org.id,
      agentId: agent?.id ?? null,
      phoneNumberId: number?.id ?? existing?.phoneNumberId ?? null,
      contactId: typeof metadata.contactId === "string" ? metadata.contactId : existing?.contactId ?? null,
      campaignId: typeof metadata.campaignId === "string" ? metadata.campaignId : existing?.campaignId ?? null,
      cartesiaCallId: cartesiaCallId || null,
      direction: (telephony.direction as "inbound" | "outbound" | undefined) ?? existing?.direction ?? "inbound",
      status: status ?? existing?.status ?? "started",
      fromNumber: fromNumber ?? null,
      toNumber: toNumber ?? null,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      durationSeconds: duration,
      creditsCharged,
      endReason: call.end_reason ? String(call.end_reason) : existing?.endReason ?? null,
      summary: call.summary ? String(call.summary) : existing?.summary ?? null,
      transcript: Array.isArray(call.transcript) ? call.transcript : existing?.transcript ?? [],
      telephonyAccountType: call.telephony_account_type ? String(call.telephony_account_type) : existing?.telephonyAccountType ?? null,
      metadata: { ...(existing?.metadata ?? {}), ...metadata },
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(calls).set(values).where(eq(calls.id, existing.id));
    } else {
      await db.insert(calls).values({ ...values, direction: values.direction });
    }
    if (eventType === "call_completed") {
      await enqueueCrmSync(org.id, cartesiaCallId);
    }
    return { ok: true };
  });

  app.post("/internal/tools/calendar/:action", async (req, reply) => {
    const organizationId = String(req.headers["x-dialix-organization"] ?? "");
    if (!organizationId) return reply.code(400).send({ error: "Missing organization" });
    const { action } = req.params as { action: string };
    const body = req.body as Record<string, unknown>;
    const calendar = await getCalendarConnector(organizationId);
    if (!calendar && action !== "book") return reply.send({ slots: [], error: "No calendar connected" });
    if (action === "availability") {
      const slots = await calendar!.connector.listAvailability(
        String(body.start ?? new Date().toISOString()),
        String(body.end ?? new Date(Date.now() + 86400000 * 3).toISOString()),
        Number(body.durationMinutes ?? 30),
      );
      return { slots };
    }
    if (action === "book") {
      let externalEventId: string | null = null;
      if (calendar) {
        const created = await calendar.connector.createAppointment({
          title: String(body.title ?? "Appointment"),
          start: String(body.start),
          end: String(body.end),
          attendeeEmail: body.attendeeEmail ? String(body.attendeeEmail) : null,
          attendeeName: body.attendeeName ? String(body.attendeeName) : null,
          notes: body.notes ? String(body.notes) : null,
        });
        externalEventId = created.id;
      }
      const [row] = await db
        .insert(appointments)
        .values({
          organizationId,
          calendarProvider: calendar?.provider,
          externalEventId,
          title: String(body.title ?? "Appointment"),
          startsAt: new Date(String(body.start)),
          endsAt: new Date(String(body.end)),
          attendeeEmail: body.attendeeEmail ? String(body.attendeeEmail) : null,
          attendeePhone: body.attendeePhone ? String(body.attendeePhone) : null,
          notes: body.notes ? String(body.notes) : null,
        })
        .returning();
      return { appointmentId: row!.id, externalEventId };
    }
    if (action === "cancel") {
      const id = String(body.appointmentId ?? "");
      const [existing] = await db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
      if (existing?.externalEventId && calendar) await calendar.connector.cancelAppointment(existing.externalEventId);
      if (existing) await db.update(appointments).set({ status: "canceled", updatedAt: new Date() }).where(eq(appointments.id, id));
      return { ok: true };
    }
    return reply.code(404).send({ error: "Unknown action" });
  });

  app.post("/internal/tools/crm/:action", async (req, reply) => {
    const organizationId = String(req.headers["x-dialix-organization"] ?? "");
    if (!organizationId) return reply.code(400).send({ error: "Missing organization" });
    const { action } = req.params as { action: string };
    const body = req.body as Record<string, string>;
    const crm = await getCrmConnector(organizationId);
    if (action === "lookup") {
      const local = body.phone
        ? await db.select().from(contacts).where(eq(contacts.phone, body.phone)).limit(1)
        : [];
      const remote = crm && body.phone ? await crm.connector.lookupContact(body.phone).catch(() => null) : null;
      return { contact: remote ?? local[0] ?? null };
    }
    if (action === "upsert") {
      if (crm) {
        const saved = await crm.connector.upsertContact(body);
        return { contact: saved };
      }
      const [row] = await db
        .insert(contacts)
        .values({
          organizationId,
          phone: body.phone,
          firstName: body.firstName,
          lastName: body.lastName,
          email: body.email,
          company: body.company,
        })
        .onConflictDoNothing()
        .returning();
      return { contact: row ?? null };
    }
    return reply.code(404).send({ error: "Unknown action" });
  });
}
