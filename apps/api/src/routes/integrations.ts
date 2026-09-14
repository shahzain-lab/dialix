import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { customCrmConfigSchema } from "@dialix/shared";
import { integrations } from "@dialix/db";
import { env } from "../env.js";
import { db } from "../db.js";
import { assertAdmin, withOrg } from "../org.js";
import { encryptSecret } from "../crypto.js";

function oauthState(organizationId: string, provider: string) {
  return Buffer.from(JSON.stringify({ organizationId, provider, t: Date.now() })).toString("base64url");
}

function microsoftOauthBase() {
  const tenant = env.MICROSOFT_TENANT_ID.trim() || "organizations";
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
}

export async function registerIntegrationRoutes(app: FastifyInstance) {
  app.get("/api/v1/integrations", async (req) => {
    const org = await withOrg(req);
    const rows = await db.select().from(integrations).where(eq(integrations.organizationId, org.organizationId));
    return rows.map((r) => ({ ...r, tokensEncrypted: undefined, configured: Boolean(r.status === "connected") }));
  });

  app.get("/api/v1/integrations/:provider/start", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const { provider } = req.params as { provider: string };
    const redirect = `${env.API_URL}/api/v1/integrations/callback`;
    const state = oauthState(org.organizationId, provider);
    if (provider === "google_calendar") {
      if (!env.GOOGLE_CLIENT_ID) {
        return reply.code(400).send({ error: "Google Calendar is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API, then retry Connect." });
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirect);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return { url: url.toString() };
    }
    if (provider === "microsoft_365") {
      if (!env.MICROSOFT_CLIENT_ID) {
        return reply.code(400).send({ error: "Microsoft 365 is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET on the API, then retry Connect." });
      }
      const url = new URL(`${microsoftOauthBase()}/authorize`);
      url.searchParams.set("client_id", env.MICROSOFT_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirect);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "offline_access Calendars.ReadWrite User.Read");
      url.searchParams.set("state", state);
      return { url: url.toString() };
    }
    if (provider === "hubspot") {
      if (!env.HUBSPOT_CLIENT_ID) {
        return reply.code(400).send({ error: "HubSpot is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET on the API, then retry Connect." });
      }
      const url = new URL("https://app.hubspot.com/oauth/authorize");
      url.searchParams.set("client_id", env.HUBSPOT_CLIENT_ID);
      url.searchParams.set("redirect_uri", redirect);
      url.searchParams.set("scope", "crm.objects.contacts.read crm.objects.contacts.write crm.objects.calls.write");
      url.searchParams.set("state", state);
      return { url: url.toString() };
    }
    return reply.code(400).send({ error: `Unknown integration provider "${provider}". Use google_calendar, microsoft_365, or hubspot.` });
  });

  app.get("/api/v1/integrations/callback", async (req, reply) => {
    const q = req.query as { code?: string; state?: string };
    if (!q.code || !q.state) return reply.code(400).send("Missing code");
    const parsed = JSON.parse(Buffer.from(q.state, "base64url").toString("utf8")) as { organizationId: string; provider: string };
    const redirect = `${env.API_URL}/api/v1/integrations/callback`;
    let tokens: Record<string, unknown> = {};
    if (parsed.provider === "google_calendar") {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: q.code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        }),
      });
      tokens = (await res.json()) as Record<string, unknown>;
    } else if (parsed.provider === "microsoft_365") {
      const res = await fetch(`${microsoftOauthBase()}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: q.code,
          client_id: env.MICROSOFT_CLIENT_ID,
          client_secret: env.MICROSOFT_CLIENT_SECRET,
          redirect_uri: redirect,
          grant_type: "authorization_code",
        }),
      });
      tokens = (await res.json()) as Record<string, unknown>;
    } else if (parsed.provider === "hubspot") {
      const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: env.HUBSPOT_CLIENT_ID,
          client_secret: env.HUBSPOT_CLIENT_SECRET,
          redirect_uri: redirect,
          code: q.code,
        }),
      });
      tokens = (await res.json()) as Record<string, unknown>;
    }
    await db
      .insert(integrations)
      .values({
        organizationId: parsed.organizationId,
        provider: parsed.provider as "hubspot" | "google_calendar" | "microsoft_365",
        status: "connected",
        tokensEncrypted: encryptSecret(JSON.stringify(tokens)),
      })
      .onConflictDoUpdate({
        target: [integrations.organizationId, integrations.provider],
        set: { status: "connected", tokensEncrypted: encryptSecret(JSON.stringify(tokens)), updatedAt: new Date() },
      });
    return reply.redirect(`${env.APP_URL}/integrations?connected=${parsed.provider}`);
  });

  app.put("/api/v1/integrations/custom_crm", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const parsed = customCrmConfigSchema.parse(req.body);
    await db
      .insert(integrations)
      .values({
        organizationId: org.organizationId,
        provider: "custom_crm",
        status: "connected",
        tokensEncrypted: encryptSecret(parsed.authHeaderValue),
        config: { ...parsed, authHeaderValue: undefined },
      })
      .onConflictDoUpdate({
        target: [integrations.organizationId, integrations.provider],
        set: {
          status: "connected",
          tokensEncrypted: encryptSecret(parsed.authHeaderValue),
          config: { ...parsed, authHeaderValue: undefined },
          updatedAt: new Date(),
        },
      });
    return { ok: true };
  });

  app.delete("/api/v1/integrations/:provider", async (req) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const { provider } = req.params as { provider: "hubspot" | "google_calendar" | "microsoft_365" | "custom_crm" };
    await db.delete(integrations).where(and(eq(integrations.organizationId, org.organizationId), eq(integrations.provider, provider)));
    return { ok: true };
  });
}
