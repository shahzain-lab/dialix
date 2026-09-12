import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { appointments } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, withOrg } from "../org.js";
import { getCalendarConnector } from "../integrations/connectors.js";
import { httpError } from "../http.js";

export async function registerAppointmentRoutes(app: FastifyInstance) {
  app.get("/api/v1/appointments", async (req) => {
    const org = await withOrg(req);
    return db.select().from(appointments).where(eq(appointments.organizationId, org.organizationId)).orderBy(desc(appointments.startsAt));
  });

  app.post("/api/v1/appointments", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as {
      title: string;
      startsAt: string;
      endsAt: string;
      timezone?: string;
      attendeeEmail?: string;
      attendeePhone?: string;
      notes?: string;
    };
    if (!body.title?.trim()) throw httpError(400, "Appointment title is required.");
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw httpError(400, `Start time "${body.startsAt}" is not a valid timestamp. Send ISO-8601, for example 2026-09-12T15:00:00.000Z.`);
    }
    if (Number.isNaN(endsAt.getTime())) {
      throw httpError(400, `End time "${body.endsAt}" is not a valid timestamp. Send ISO-8601, for example 2026-09-12T15:30:00.000Z.`);
    }
    if (endsAt <= startsAt) throw httpError(400, "End time must be after the start time.");
    const calendar = await getCalendarConnector(org.organizationId);
    let externalEventId: string | null = null;
    if (calendar) {
      const created = await calendar.connector.createAppointment({
        title: body.title,
        start: body.startsAt,
        end: body.endsAt,
        timezone: body.timezone,
        attendeeEmail: body.attendeeEmail,
        notes: body.notes,
      });
      externalEventId = created.id;
    }
    const [row] = await db
      .insert(appointments)
      .values({
        organizationId: org.organizationId,
        calendarProvider: calendar?.provider,
        externalEventId,
        title: body.title.trim(),
        startsAt,
        endsAt,
        timezone: body.timezone ?? "UTC",
        attendeeEmail: body.attendeeEmail ?? null,
        attendeePhone: body.attendeePhone ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/appointments/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { status?: "canceled" | "completed" | "no_show"; startsAt?: string; endsAt?: string; title?: string };
    const [existing] = await db.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.organizationId, org.organizationId))).limit(1);
    if (!existing) return reply.code(404).send({ error: `Appointment ${id} was not found in this workspace.` });
    const calendar = await getCalendarConnector(org.organizationId);
    if (calendar && existing.externalEventId) {
      if (body.status === "canceled") await calendar.connector.cancelAppointment(existing.externalEventId);
      else await calendar.connector.updateAppointment(existing.externalEventId, { title: body.title, start: body.startsAt, end: body.endsAt });
    }
    const [row] = await db
      .update(appointments)
      .set({
        status: body.status ?? existing.status,
        title: body.title ?? existing.title,
        startsAt: body.startsAt ? new Date(body.startsAt) : existing.startsAt,
        endsAt: body.endsAt ? new Date(body.endsAt) : existing.endsAt,
        updatedAt: new Date(),
      })
      .where(eq(appointments.id, id))
      .returning();
    return row;
  });
}
