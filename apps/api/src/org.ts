import type { FastifyInstance, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { sql } from "drizzle-orm";
import type { OrgRole } from "@dialix/shared";
import { adminRoles, writeRoles } from "@dialix/shared";
import { auth, requireMembership } from "./auth.js";
import { db } from "./db.js";
import { httpError } from "./http.js";

export type OrgContext = {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  role: OrgRole;
};

declare module "fastify" {
  interface FastifyRequest {
    org?: OrgContext;
  }
}

export async function setOrgLocal(organizationId: string) {
  await db.execute(sql`SELECT set_config('app.current_org', ${organizationId}, true)`);
}

export async function authenticate(req: FastifyRequest): Promise<{ userId: string; email: string; name: string }> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers as Record<string, string>),
  });
  if (!session?.user) {
    throw httpError(401, "You are not signed in or your session has expired. Sign in again to continue.");
  }
  return { userId: session.user.id, email: session.user.email, name: session.user.name };
}

export function registerOrgGuard(app: FastifyInstance) {
  app.decorateRequest("org", undefined);
}

export async function withOrg(req: FastifyRequest): Promise<OrgContext> {
  const user = await authenticate(req);
  const organizationId =
    (req.headers["x-organization-id"] as string | undefined) ||
    (typeof req.query === "object" && req.query && "organizationId" in req.query
      ? String((req.query as { organizationId?: string }).organizationId)
      : "");
  if (!organizationId) {
    throw httpError(400, "No workspace selected. Choose an organization in the sidebar and retry.");
  }
  const membership = await requireMembership(user.userId, organizationId);
  await setOrgLocal(organizationId);
  const ctx: OrgContext = {
    userId: user.userId,
    email: user.email,
    name: user.name,
    organizationId,
    role: membership.role,
  };
  req.org = ctx;
  return ctx;
}

export function assertWrite(role: OrgRole) {
  if (!writeRoles.includes(role)) {
    throw httpError(403, "Your role is view-only. Ask a workspace admin to grant operator access before making changes.");
  }
}

export function assertAdmin(role: OrgRole) {
  if (!adminRoles.includes(role)) {
    throw httpError(403, "Only workspace owners and admins can manage billing, team, and integrations.");
  }
}

export async function audit(
  org: OrgContext,
  action: string,
  resourceType: string,
  resourceId?: string,
  metadata: Record<string, unknown> = {},
) {
  const { auditLog } = await import("@dialix/db");
  await db.insert(auditLog).values({
    organizationId: org.organizationId,
    userId: org.userId,
    action,
    resourceType,
    resourceId,
    metadata,
  });
}
