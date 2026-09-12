import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { signupSchema } from "@dialix/shared";
import { auth, pendingSignups, userMemberships } from "../auth.js";
import { authenticate } from "../org.js";
import { db } from "../db.js";
import { organizations } from "@dialix/db";
import { env } from "../env.js";

async function proxyAuth(req: { method: string; url: string; headers: Record<string, unknown>; rawBody?: Buffer }, reply: { status: (n: number) => unknown; header: (k: string, v: string) => unknown; send: (b: unknown) => unknown }) {
  const url = new URL(req.url, env.BETTER_AUTH_URL);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, String(value));
  }
  const request = new Request(url, {
    method: req.method,
    headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : req.rawBody,
  });
  const response = await auth.handler(request);
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    reply.header(key, value);
  });
  const buf = Buffer.from(await response.arrayBuffer());
  return reply.send(buf);
}

export async function registerAuthRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    url: "/api/auth/*",
    handler: async (req, reply) => proxyAuth(req as never, reply as never),
  });

  app.post("/api/v1/signup", async (req, reply) => {
    const parsed = signupSchema.parse(req.body);
    pendingSignups.set(parsed.email.toLowerCase(), {
      organizationName: parsed.organizationName,
      inviteToken: parsed.inviteToken,
    });
    return reply.send({ ok: true });
  });

  app.get("/api/v1/me", async (req, reply) => {
    const user = await authenticate(req);
    const rows = await userMemberships(user.userId);
    return reply.send({
      user,
      organizations: rows.map((r) => ({ ...r.organization, role: r.membership.role })),
    });
  });

  app.patch("/api/v1/organizations/:id", async (req, reply) => {
    const user = await authenticate(req);
    const { id } = req.params as { id: string };
    const memberships = await userMemberships(user.userId);
    const mine = memberships.find((m) => m.organization.id === id);
    if (!mine || !["owner", "admin"].includes(mine.membership.role)) {
      return reply.code(403).send({ error: "Only workspace owners and admins can change organization settings." });
    }
    const body = req.body as {
      name?: string;
      timezone?: string;
      defaultTransferNumber?: string;
      tcpaDisclaimer?: string;
    };
    const [updated] = await db
      .update(organizations)
      .set({
        name: body.name ?? mine.organization.name,
        timezone: body.timezone ?? mine.organization.timezone,
        defaultTransferNumber: body.defaultTransferNumber ?? mine.organization.defaultTransferNumber,
        tcpaDisclaimer: body.tcpaDisclaimer ?? mine.organization.tcpaDisclaimer,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, id))
      .returning();
    return reply.send(updated);
  });

  app.get("/api/health", async () => ({ ok: true, service: "dialix-api" }));
}
