import { eq, and } from "drizzle-orm";
import { integrations } from "@dialix/db";
import { decryptSecret } from "../crypto.js";
import { db } from "../db.js";
import { googleCalendar, microsoftCalendar } from "./calendar.js";
import { customCrm, hubspotCrm } from "./crm.js";
import type { CalendarConnector, CrmConnector } from "./types.js";

async function loadIntegration(organizationId: string, provider: typeof integrations.$inferSelect.provider) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.provider, provider)))
    .limit(1);
  return row ?? null;
}

export async function getCalendarConnector(organizationId: string): Promise<{ provider: string; connector: CalendarConnector } | null> {
  const google = await loadIntegration(organizationId, "google_calendar");
  if (google?.status === "connected" && google.tokensEncrypted) {
    return { provider: "google_calendar", connector: googleCalendar(JSON.parse(decryptSecret(google.tokensEncrypted))) };
  }
  const ms = await loadIntegration(organizationId, "microsoft_365");
  if (ms?.status === "connected" && ms.tokensEncrypted) {
    return { provider: "microsoft_365", connector: microsoftCalendar(JSON.parse(decryptSecret(ms.tokensEncrypted))) };
  }
  return null;
}

export async function getCrmConnector(organizationId: string): Promise<{ provider: string; connector: CrmConnector } | null> {
  const hubspot = await loadIntegration(organizationId, "hubspot");
  if (hubspot?.status === "connected" && hubspot.tokensEncrypted) {
    return { provider: "hubspot", connector: hubspotCrm(JSON.parse(decryptSecret(hubspot.tokensEncrypted))) };
  }
  const custom = await loadIntegration(organizationId, "custom_crm");
  if (custom?.status === "connected" && custom.config) {
    const cfg = custom.config as {
      baseUrl: string;
      authHeaderName: string;
      authHeaderValue: string;
      lookupPath: string;
      upsertPath: string;
      logCallPath: string;
      phoneQueryParam: string;
    };
    if (custom.tokensEncrypted) {
      cfg.authHeaderValue = decryptSecret(custom.tokensEncrypted);
    }
    return { provider: "custom_crm", connector: customCrm(cfg) };
  }
  return null;
}
