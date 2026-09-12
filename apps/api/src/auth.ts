import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq, and } from "drizzle-orm";
import { db } from "./db.js";
import { env } from "./env.js";
import * as schema from "@dialix/db";
import { organizations, memberships, invites, kbFolders } from "@dialix/db";
import { slugify } from "./crypto.js";

export const pendingSignups = new Map<string, { organizationName?: string; inviteToken?: string }>();

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [env.APP_URL, env.API_URL, env.BETTER_AUTH_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: { enabled: true },
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
      httpOnly: true,
      secure: env.NODE_ENV === "production",
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (created) => {
          const pending = pendingSignups.get(created.email.toLowerCase());
          pendingSignups.delete(created.email.toLowerCase());
          if (pending?.inviteToken) {
            const [invite] = await db.select().from(invites).where(eq(invites.token, pending.inviteToken)).limit(1);
            if (invite && !invite.acceptedAt && invite.expiresAt > new Date()) {
              await db.insert(memberships).values({
                organizationId: invite.organizationId,
                userId: created.id,
                role: invite.role,
              });
              await db.update(invites).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(eq(invites.id, invite.id));
              return;
            }
          }
          const base = slugify(pending?.organizationName || created.name || created.email.split("@")[0] || "org");
          let slug = base;
          let n = 1;
          while (true) {
            const existing = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug)).limit(1);
            if (!existing.length) break;
            slug = `${base}-${n++}`;
          }
          const [org] = await db
            .insert(organizations)
            .values({
              name: pending?.organizationName || `${created.name}'s workspace`,
              slug,
            })
            .returning();
          await db.insert(memberships).values({
            organizationId: org!.id,
            userId: created.id,
            role: "owner",
          });
          await db.insert(kbFolders).values({
            organizationId: org!.id,
            name: `dialix_${org!.id.slice(0, 8)}`,
            isRoot: true,
          });
        },
      },
    },
  },
});

export async function userMemberships(userId: string) {
  return db
    .select({ membership: memberships, organization: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId));
}

export async function requireMembership(userId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!row) {
    const { httpError } = await import("./http.js");
    throw httpError(403, "You are not a member of that workspace. Switch organization or ask an owner for an invite.");
  }
  return row;
}
