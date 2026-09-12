import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { contactSchema, assertE164 } from "@dialix/shared";
import { contactListMembers, contactLists, contacts } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";

export async function registerContactRoutes(app: FastifyInstance) {
  app.get("/api/v1/contacts", async (req) => {
    const org = await withOrg(req);
    return db.select().from(contacts).where(eq(contacts.organizationId, org.organizationId));
  });

  app.post("/api/v1/contacts", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = contactSchema.parse(req.body);
    const phone = assertE164(parsed.phone);
    const [row] = await db
      .insert(contacts)
      .values({
        organizationId: org.organizationId,
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        phone,
        email: parsed.email,
        company: parsed.company,
        timezone: parsed.timezone,
        consentAt: parsed.consentAt ? new Date(parsed.consentAt) : null,
        consentSource: parsed.consentSource,
        metadata: parsed.metadata ?? {},
      })
      .returning();
    await audit(org, "create", "contact", row!.id);
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/contacts/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const parsed = contactSchema.partial().parse(req.body);
    const [existing] = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), eq(contacts.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Contact ${id} was not found in this workspace.` });
    const [row] = await db
      .update(contacts)
      .set({
        firstName: parsed.firstName ?? existing.firstName,
        lastName: parsed.lastName ?? existing.lastName,
        phone: parsed.phone ? assertE164(parsed.phone) : existing.phone,
        email: parsed.email === undefined ? existing.email : parsed.email,
        company: parsed.company ?? existing.company,
        timezone: parsed.timezone ?? existing.timezone,
        consentAt: parsed.consentAt ? new Date(parsed.consentAt) : existing.consentAt,
        consentSource: parsed.consentSource ?? existing.consentSource,
        updatedAt: new Date(),
      })
      .where(eq(contacts.id, id))
      .returning();
    return row;
  });

  app.delete("/api/v1/contacts/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.organizationId, org.organizationId)));
    await audit(org, "delete", "contact", id);
    return { ok: true };
  });

  app.post("/api/v1/contacts/import", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { rows: Array<Record<string, string>>; listId?: string };
    if (!body.rows?.length) {
      return reply.code(400).send({ error: "CSV import contained no data rows. Include a header plus at least one contact with a phone column." });
    }
    const created = [];
    let skipped = 0;
    for (const row of body.rows) {
      const phone = row.phone || row.Phone || row.number;
      if (!phone) {
        skipped += 1;
        continue;
      }
      try {
        const [item] = await db
          .insert(contacts)
          .values({
            organizationId: org.organizationId,
            firstName: row.firstName || row.first_name || row.FirstName || null,
            lastName: row.lastName || row.last_name || row.LastName || null,
            phone: assertE164(phone),
            email: row.email || row.Email || null,
            company: row.company || row.Company || null,
            consentAt: row.consent === "true" || row.consent_at ? new Date() : null,
            consentSource: row.consent_source || "csv_import",
          })
          .onConflictDoNothing()
          .returning();
        if (item) {
          created.push(item);
          if (body.listId) {
            await db.insert(contactListMembers).values({
              organizationId: org.organizationId,
              listId: body.listId,
              contactId: item.id,
            }).onConflictDoNothing();
          }
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }
    return reply.send({ imported: created.length, skipped, total: body.rows.length });
  });

  app.get("/api/v1/contacts/export", async (req, reply) => {
    const org = await withOrg(req);
    const rows = await db.select().from(contacts).where(eq(contacts.organizationId, org.organizationId));
    const header = "firstName,lastName,phone,email,company,consentAt,consentSource";
    const lines = rows.map((r) =>
      [r.firstName, r.lastName, r.phone, r.email, r.company, r.consentAt?.toISOString() ?? "", r.consentSource]
        .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
        .join(","),
    );
    reply.header("Content-Disposition", "attachment; filename=contacts.csv");
    return reply.type("text/csv").send([header, ...lines].join("\n"));
  });

  app.get("/api/v1/lists", async (req) => {
    const org = await withOrg(req);
    const lists = await db.select().from(contactLists).where(eq(contactLists.organizationId, org.organizationId));
    const withCounts = [];
    for (const list of lists) {
      const members = await db.select().from(contactListMembers).where(eq(contactListMembers.listId, list.id));
      withCounts.push({ ...list, memberCount: members.length });
    }
    return withCounts;
  });

  app.post("/api/v1/lists", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { name: string; description?: string };
    if (!body.name?.trim()) return reply.code(400).send({ error: "Give the list a name before creating it." });
    const [row] = await db
      .insert(contactLists)
      .values({ organizationId: org.organizationId, name: body.name, description: body.description ?? null })
      .returning();
    await audit(org, "create", "contact_list", row!.id);
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/lists/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; description?: string };
    const [row] = await db
      .update(contactLists)
      .set({ name: body.name, description: body.description, updatedAt: new Date() })
      .where(and(eq(contactLists.id, id), eq(contactLists.organizationId, org.organizationId)))
      .returning();
    if (!row) return reply.code(404).send({ error: `List ${id} was not found in this workspace.` });
    return row;
  });

  app.delete("/api/v1/lists/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    await db.delete(contactLists).where(and(eq(contactLists.id, id), eq(contactLists.organizationId, org.organizationId)));
    return { ok: true };
  });

  app.get("/api/v1/lists/:id/members", async (req) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const members = await db.select().from(contactListMembers).where(and(eq(contactListMembers.listId, id), eq(contactListMembers.organizationId, org.organizationId)));
    const ids = members.map((m) => m.contactId);
    if (!ids.length) return [];
    const all = await db.select().from(contacts).where(eq(contacts.organizationId, org.organizationId));
    return all.filter((c) => ids.includes(c.id));
  });

  app.post("/api/v1/lists/:id/members", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { contactIds: string[] };
    if (!body.contactIds?.length) return reply.code(400).send({ error: "Select at least one contact to add to this list." });
    for (const contactId of body.contactIds) {
      await db.insert(contactListMembers).values({ organizationId: org.organizationId, listId: id, contactId }).onConflictDoNothing();
    }
    return { ok: true };
  });

  app.delete("/api/v1/lists/:id/members/:contactId", async (req) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id, contactId } = req.params as { id: string; contactId: string };
    await db
      .delete(contactListMembers)
      .where(
        and(
          eq(contactListMembers.organizationId, org.organizationId),
          eq(contactListMembers.listId, id),
          eq(contactListMembers.contactId, contactId),
        ),
      );
    return { ok: true };
  });
}
