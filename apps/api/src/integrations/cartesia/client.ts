import { env } from "../../env.js";

export class CartesiaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "CartesiaError";
  }
}

function describeCartesiaFailure(status: number, path: string, body: unknown): string {
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const nested = payload.error && typeof payload.error === "object" ? (payload.error as Record<string, unknown>) : payload;
  const fromApi = String(nested.message ?? nested.error ?? payload.message ?? "").trim();
  if (status === 401 || status === 403) {
    return fromApi || "Cartesia rejected the platform API key. Check CARTESIA_API_KEY and organization access.";
  }
  if (status === 402) {
    return fromApi || "Cartesia quota exceeded (credits or phone-number slots). Free a number or upgrade the Cartesia plan.";
  }
  if (status === 404) {
    return fromApi || `Cartesia could not find that resource (${path}). It may have been deleted in the Cartesia playground.`;
  }
  if (status === 429) {
    return fromApi || "Cartesia rate-limited this request. Wait a few seconds and retry.";
  }
  if (status >= 500) {
    return fromApi || "Cartesia is temporarily unavailable. Try again in a moment.";
  }
  return fromApi || `Cartesia request failed (${status}) for ${path}.`;
}

export function cartesiaConfigured(): boolean {
  return Boolean(env.CARTESIA_API_KEY);
}

async function cartesiaFetch<T>(
  path: string,
  init: RequestInit = {},
  apiKey = env.CARTESIA_API_KEY,
): Promise<T> {
  if (!apiKey) {
    throw new CartesiaError(
      "Cartesia is not connected. Add CARTESIA_API_KEY to the API environment to provision numbers, sync agents, or place live calls.",
      503,
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("X-API-Key", apiKey);
  headers.set("Cartesia-Version", env.CARTESIA_VERSION);
  if (init.body && !headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`https://api.cartesia.ai${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new CartesiaError(describeCartesiaFailure(res.status, path, json), res.status, json);
  }
  return json as T;
}

async function cartesiaFetchBytes(path: string, init: RequestInit = {}, apiKey = env.CARTESIA_API_KEY): Promise<{ bytes: Buffer; contentType: string }> {
  if (!apiKey) {
    throw new CartesiaError("Cartesia is not connected. Add CARTESIA_API_KEY to preview voices or generate speech.", 503);
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("X-API-Key", apiKey);
  headers.set("Cartesia-Version", env.CARTESIA_VERSION);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`https://api.cartesia.ai${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    throw new CartesiaError(describeCartesiaFailure(res.status, path, json), res.status, json);
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "audio/wav" };
}

export type CartesiaVoice = {
  id: string;
  name?: string;
  tagline?: string;
  description?: string;
  gender?: string | null;
  language?: string;
  accents?: Array<{ accent: string; locale: string; is_native: boolean }>;
  is_owner?: boolean;
  access?: string;
  is_pro?: boolean;
  preview_file_url?: string | null;
};

type VoiceListResponse = { data?: CartesiaVoice[]; voices?: CartesiaVoice[]; has_more?: boolean; next_page?: string | null };

export type ManagedAgentConfig = {
  name: string;
  event_webhook_id?: string | null;
  config: {
    instructions: string;
    initial_message?: string | null;
    model: { id: string; temperature?: number | null; max_output_tokens?: number | null };
    language: { primary: string };
    audio: {
      input: { noise_suppression: "off" | "auto" | "max"; keyterms?: string[] };
      output: {
        voice_id: string;
        speed?: number | null;
        volume?: number | null;
        emotion?: string | null;
        pronunciation_dictionary_id?: string | null;
      };
    };
    tools?: Array<{ id: string }>;
    system_tools?: {
      end_call?: { description?: string | null; pre_tool_speech?: "auto" | "force" } | null;
      send_dtmf?: { description?: string | null; pre_tool_speech?: "auto" | "force" } | null;
      transfer_to_number?: {
        description?: string | null;
        pre_tool_speech?: "auto" | "force";
        transfers: Array<{
          destination: { type: "phone" | "sip_uri"; phone_number?: string; sip_uri?: string };
          condition: string;
        }>;
      } | null;
    };
  };
};

export const cartesia = {
  configured: cartesiaConfigured,
  createAgent(body: ManagedAgentConfig, apiKey?: string) {
    return cartesiaFetch<{ id: string } & ManagedAgentConfig>("/v1/agents", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  getAgent(id: string, apiKey?: string) {
    return cartesiaFetch(`/v1/agents/${id}`, {}, apiKey);
  },
  updateAgent(id: string, body: Partial<ManagedAgentConfig>, apiKey?: string) {
    return cartesiaFetch(`/v1/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }, apiKey);
  },
  deleteAgent(id: string, apiKey?: string) {
    return cartesiaFetch(`/v1/agents/${id}`, { method: "DELETE" }, apiKey);
  },
  listModels(apiKey?: string) {
    return cartesiaFetch<{ data?: Array<{ id: string; display_name?: string; name?: string; provider?: string }> }>("/v1/agents/models", {}, apiKey);
  },
  listTemplates(apiKey?: string) {
    return cartesiaFetch<{ templates?: unknown[]; data?: unknown[] } | unknown[]>("/v1/agents/templates", {}, apiKey);
  },
  listVoices(apiKey?: string, query?: Record<string, string | number | boolean | undefined>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue;
      params.set(key, String(value));
    }
    if (!params.has("limit")) params.set("limit", "100");
    if (!params.has("expand[]")) params.append("expand[]", "preview_file_url");
    const qs = params.toString();
    return cartesiaFetch<VoiceListResponse>(`/voices${qs ? `?${qs}` : ""}`, {}, apiKey);
  },
  getVoice(id: string, apiKey?: string) {
    return cartesiaFetch<CartesiaVoice>(`/voices/${id}?${new URLSearchParams({ "expand[]": "preview_file_url" })}`, {}, apiKey);
  },
  async previewVoiceFile(url: string, apiKey = env.CARTESIA_API_KEY) {
    if (!apiKey) throw new CartesiaError("Cartesia is not connected.", 503);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, "X-API-Key": apiKey, "Cartesia-Version": env.CARTESIA_VERSION },
    });
    if (!res.ok) throw new CartesiaError("Cartesia voice preview could not be downloaded.", res.status);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") || "audio/mpeg" };
  },
  ttsBytes(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetchBytes("/tts/bytes", { method: "POST", body: JSON.stringify(body) }, apiKey);
  },
  cloneVoice(form: FormData, apiKey?: string) {
    return cartesiaFetch<{ id: string; name?: string }>("/voices/clone", { method: "POST", body: form }, apiKey);
  },
  deleteVoice(id: string, apiKey?: string) {
    return cartesiaFetch(`/voices/${id}`, { method: "DELETE" }, apiKey);
  },
  createFolder(name: string, parentId: string | null, apiKey?: string) {
    return cartesiaFetch<{ id: string }>("/agents/folders", {
      method: "POST",
      body: JSON.stringify({ name, parent_id: parentId }),
    }, apiKey);
  },
  updateFolder(id: string, body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch(`/agents/folders/${id}`, { method: "PATCH", body: JSON.stringify(body) }, apiKey);
  },
  deleteFolder(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/folders/${id}`, { method: "DELETE" }, apiKey);
  },
  createDocument(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ id: string }>("/agents/documents", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  bulkCreateDocuments(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ documents?: Array<{ id: string }> }>("/agents/documents/bulk", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  updateDocument(id: string, body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch(`/agents/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }, apiKey);
  },
  deleteDocument(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/documents/${id}`, { method: "DELETE" }, apiKey);
  },
  provisionNumber(label: string, agentId?: string, apiKey?: string) {
    return cartesiaFetch<{ id: string; number: string; label?: string }>(
      "/agents/phone-numbers/provision",
      { method: "POST", body: JSON.stringify({ label, agent_id: agentId }) },
      apiKey,
    );
  },
  createProvider(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ id: string }>("/agents/phone-numbers/providers", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  importNumber(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ id: string; number?: string }>("/agents/phone-numbers", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  assignNumber(id: string, agentId: string | null, apiKey?: string) {
    return cartesiaFetch(`/agents/phone-numbers/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ agent_id: agentId }),
    }, apiKey);
  },
  deleteNumber(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/phone-numbers/${id}`, { method: "DELETE" }, apiKey);
  },
  createOutboundCall(body: {
    from_number_id: string;
    agent_id: string;
    ringing_timeout_seconds?: number;
    max_call_duration_minutes?: number;
    outbound_calls: Array<{ to_number: string; metadata?: Record<string, unknown> }>;
  }, apiKey?: string) {
    return cartesiaFetch<{ calls: Array<{ agent_call_id?: string; error?: unknown }> }>(
      "/agents/calls",
      { method: "POST", body: JSON.stringify(body) },
      apiKey,
    );
  },
  createCallBatch(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ id: string; status?: string }>("/agents/calls/batches", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  getCallBatch(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/calls/batches/${id}`, {}, apiKey);
  },
  retryCallBatch(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/calls/batches/${id}/retry`, { method: "POST" }, apiKey);
  },
  cancelCallBatch(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/calls/batches/${id}/cancel`, { method: "POST" }, apiKey);
  },
  getCall(id: string, apiKey?: string) {
    return cartesiaFetch(`/agents/calls/${id}`, {}, apiKey);
  },
  createWebhook(url: string, secret: string, apiKey?: string) {
    return cartesiaFetch<{ id: string; secret?: string; url?: string }>("/agents/webhooks", {
      method: "POST",
      body: JSON.stringify({ url, secret, display_name: "Dialix" }),
    }, apiKey);
  },
  listWebhooks(apiKey?: string) {
    return cartesiaFetch<{ data?: Array<{ id: string; url: string; display_name?: string | null }> }>("/agents/webhooks?limit=100", {}, apiKey);
  },
  async listAgents(apiKey?: string) {
    const listed = await cartesiaFetch<{ data?: Array<{ id: string; name?: string }>; agents?: Array<{ id: string }> } | Array<{ id: string }>>(
      "/v1/agents",
      {},
      apiKey,
    );
    const data = Array.isArray(listed) ? listed : (listed.data ?? listed.agents ?? []);
    return { data };
  },
  createTool(body: Record<string, unknown>, apiKey?: string) {
    return cartesiaFetch<{ id: string }>("/v1/agents/tools", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiKey);
  },
  createAccessToken(grants: Record<string, boolean>, expiresIn = 3600, apiKey?: string) {
    return cartesiaFetch<{ token: string }>("/access-token", {
      method: "POST",
      body: JSON.stringify({ grants, expires_in: expiresIn }),
    }, apiKey);
  },
};
