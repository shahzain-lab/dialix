import type { CrmConnector, ContactRecord, CallLogInput } from "./types.js";

type Tokens = { access_token: string; refresh_token?: string };

export function hubspotCrm(tokens: Tokens): CrmConnector {
  async function hs(path: string, init: RequestInit = {}) {
    const res = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`HubSpot ${res.status}`);
    return res.json();
  }

  return {
    async lookupContact(phone) {
      const data = (await hs("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [
            { filters: [{ propertyName: "phone", operator: "EQ", value: phone }] },
          ],
          properties: ["firstname", "lastname", "phone", "email", "company"],
          limit: 1,
        }),
      })) as { results?: Array<{ id: string; properties: Record<string, string> }> };
      const row = data.results?.[0];
      if (!row) return null;
      return {
        id: row.id,
        firstName: row.properties.firstname,
        lastName: row.properties.lastname,
        phone: row.properties.phone,
        email: row.properties.email,
        company: row.properties.company,
        raw: row,
      };
    },
    async upsertContact(contact) {
      const existing = contact.phone ? await this.lookupContact(contact.phone) : null;
      const properties = {
        firstname: contact.firstName ?? "",
        lastname: contact.lastName ?? "",
        phone: contact.phone ?? "",
        email: contact.email ?? "",
        company: contact.company ?? "",
      };
      if (existing?.id) {
        const data = (await hs(`/crm/v3/objects/contacts/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        })) as { id: string };
        return { ...contact, id: data.id };
      }
      const data = (await hs("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties }),
      })) as { id: string };
      return { ...contact, id: data.id };
    },
    async logCall(input: CallLogInput) {
      await hs("/crm/v3/objects/calls", {
        method: "POST",
        body: JSON.stringify({
          properties: {
            hs_timestamp: Date.now(),
            hs_call_title: `${input.direction} voice call`,
            hs_call_body: input.summary ?? "",
            hs_call_duration: String((input.durationSeconds || 0) * 1000),
            hs_call_direction: input.direction === "inbound" ? "INBOUND" : "OUTBOUND",
            hs_call_status: "COMPLETED",
          },
        }),
      }).catch(() => undefined);
    },
  };
}

export function customCrm(config: {
  baseUrl: string;
  authHeaderName: string;
  authHeaderValue: string;
  lookupPath: string;
  upsertPath: string;
  logCallPath: string;
  phoneQueryParam: string;
}): CrmConnector {
  async function req(path: string, init: RequestInit = {}) {
    const url = path.startsWith("http") ? path : `${config.baseUrl.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        [config.authHeaderName]: config.authHeaderValue,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`Custom CRM ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  return {
    async lookupContact(phone) {
      const path = `${config.lookupPath}${config.lookupPath.includes("?") ? "&" : "?"}${config.phoneQueryParam}=${encodeURIComponent(phone)}`;
      const data = (await req(path)) as ContactRecord & { contact?: ContactRecord };
      return data.contact ?? data;
    },
    async upsertContact(contact) {
      const data = (await req(config.upsertPath, {
        method: "POST",
        body: JSON.stringify(contact),
      })) as ContactRecord;
      return data;
    },
    async logCall(input) {
      await req(config.logCallPath, { method: "POST", body: JSON.stringify(input) }).catch(() => undefined);
    },
  };
}
