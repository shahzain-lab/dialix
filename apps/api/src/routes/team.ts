import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { orgRoleSchema } from "@dialix/shared";
import { invites, memberships, user } from "@dialix/db";
import { db } from "../db.js";
import { assertAdmin, audit, withOrg } from "../org.js";

export async function registerTeamRoutes(app: FastifyInstance) {
  app.get("/api/v1/team", async (req) => {
    const org = await withOrg(req);
    const members = await db.select().from(memberships).where(eq(memberships.organizationId, org.organizationId));
    const users = await db.select().from(user);
    const inviteRows = await db.select().from(invites).where(eq(invites.organizationId, org.organizationId));
    return {
      members: members.map((m) => ({
        ...m,
        user: users.find((u) => u.id === m.userId) ?? null,
      })),
      invites: inviteRows.filter((i) => !i.acceptedAt),
    };
  });

  app.post("/api/v1/team/invites", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const body = req.body as { email: string; role: string };
    if (!body.email?.trim()) return reply.code(400).send({ error: "Enter the teammate's email address." });
    const role = orgRoleSchema.parse(body.role);
    const token = randomBytes(24).toString("hex");
    const [row] = await db
      .insert(invites)
      .values({
        organizationId: org.organizationId,
        email: body.email.toLowerCase(),
        role,
        token,
        invitedByUserId: org.userId,
        expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      })
      .returning();
    await audit(org, "create", "invite", row!.id);
    return reply.code(201).send({ ...row, inviteUrl: `${process.env.APP_URL}/signup?invite=${token}` });
  });

  app.patch("/api/v1/team/:membershipId", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const { membershipId } = req.params as { membershipId: string };
    const body = req.body as { role: string };
    const role = orgRoleSchema.parse(body.role);
    const [row] = await db
      .update(memberships)
      .set({ role, updatedAt: new Date() })
      .where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, org.organizationId)))
      .returning();
    if (!row) return reply.code(404).send({ error: `Membership ${membershipId} was not found in this workspace.` });
    return row;
  });

  app.delete("/api/v1/team/:membershipId", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const { membershipId } = req.params as { membershipId: string };
    const [existing] = await db.select().from(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, org.organizationId))).limit(1);
    if (existing?.role === "owner") return reply.code(400).send({ error: "The workspace owner cannot be removed. Transfer ownership first." });
    await db.delete(memberships).where(and(eq(memberships.id, membershipId), eq(memberships.organizationId, org.organizationId)));
    return { ok: true };
  });
}
