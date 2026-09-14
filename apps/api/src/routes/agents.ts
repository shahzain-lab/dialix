import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { agentConfigSchema, AGENT_EMOTIONS, AGENT_LANGUAGES, DEFAULT_AGENT_MODEL, KNOWLEDGE_SOURCES, NOISE_SUPPRESSION } from "@dialix/shared";
import { agentFolders, agents, kbFolders, organizations } from "@dialix/db";
import { db } from "../db.js";
import { audit, assertWrite, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { applyTemplate, toCartesiaAgent, toolDefinitions } from "../services/agents.js";
import { ensureCartesiaWebhook } from "../services/webhooks.js";
import { decryptSecret } from "../crypto.js";

function resolveModelId(modelId: string | null | undefined) {
  if (!modelId || modelId === "gpt-5.4-mini") return DEFAULT_AGENT_MODEL;
  return modelId;
}

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

function unwrapList<T>(res: unknown, keys: string[]): T[] {
  if (Array.isArray(res)) return res as T[];
  if (res && typeof res === "object") {
    for (const key of keys) {
      const value = (res as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

async function ensureTools(organizationId: string, apiKey?: string) {
  if (!cartesia.configured() && !apiKey) return [];
  const ids: string[] = [];
  let lastError: unknown;
  for (const tool of toolDefinitions(organizationId)) {
    try {
      const created = await cartesia.createTool(tool, apiKey);
      if (created.id) ids.push(created.id);
    } catch (err) {
      lastError = err;
    }
  }
  if (!ids.length && lastError) throw lastError;
  return ids;
}

async function provisionCartesiaAgent(input: Parameters<typeof toCartesiaAgent>[0], apiKey?: string) {
  if (!cartesia.configured() && !apiKey) return { cartesiaAgentId: null as string | null, toolIds: [] as string[] };
  const toolIds = await ensureTools(input.organizationId, apiKey);
  const created = await cartesia.createAgent(toCartesiaAgent({ ...input, toolIds }), apiKey);
  const webhookId = await ensureCartesiaWebhook(apiKey).catch(() => null);
  if (created.id && webhookId) {
    await cartesia.attachCallWebhook(created.id, webhookId, apiKey).catch(() => undefined);
  }
  return { cartesiaAgentId: created.id, toolIds };
}

async function syncFolderAccess(organizationId: string, agentId: string, cartesiaAgentId: string | null, folderIds: string[], apiKey?: string) {
  await db.delete(agentFolders).where(and(eq(agentFolders.organizationId, organizationId), eq(agentFolders.agentId, agentId)));
  for (const folderId of folderIds) {
    await db.insert(agentFolders).values({ organizationId, agentId, folderId });
  }
  if (!cartesiaAgentId) return;
  const folders = await db.select().from(kbFolders).where(eq(kbFolders.organizationId, organizationId));
  for (const folder of folders) {
    if (!folder.cartesiaFolderId) continue;
    const attached = folderIds.includes(folder.id);
    const currentAgents = attached ? [{ id: cartesiaAgentId }] : [];
    await cartesia.updateFolder(folder.cartesiaFolderId, { agents: currentAgents }, apiKey).catch(() => undefined);
  }
}

export async function registerAgentRoutes(app: FastifyInstance) {
  app.get("/api/v1/agents", async (req) => {
    const org = await withOrg(req);
    return db.select().from(agents).where(eq(agents.organizationId, org.organizationId)).orderBy(desc(agents.updatedAt));
  });

  app.get("/api/v1/agents/models", async (req) => {
    await withOrg(req);
    const configured = cartesia.configured();
    if (!configured) {
      return { configured, models: [{ id: DEFAULT_AGENT_MODEL, provider: "anthropic", name: "Claude Haiku 4.5" }] };
    }
    const res = await cartesia.listModels();
    const models = unwrapList<{ id: string; display_name?: string; name?: string; provider?: string }>(res, ["data", "models"]).map((model) => ({
      id: model.id,
      name: model.display_name ?? model.name ?? model.id,
      provider: model.provider,
    }));
    return { configured, models };
  });

  app.get("/api/v1/agents/templates", async (req) => {
    await withOrg(req);
    if (!cartesia.configured()) {
      return {
        templates: [
          { id: "appointment_setter", name: "Appointment setter" },
          { id: "support", name: "Support" },
          { id: "blank", name: "Blank" },
        ],
      };
    }
    const res = await cartesia.listTemplates().catch(() => ({ templates: [] }));
    return { templates: unwrapList(res, ["templates", "data"]) };
  });

  app.get("/api/v1/agents/options", async (req) => {
    await withOrg(req);
    return {
      cartesiaConfigured: cartesia.configured(),
      languages: AGENT_LANGUAGES,
      emotions: AGENT_EMOTIONS,
      noise: NOISE_SUPPRESSION,
      knowledgeSources: KNOWLEDGE_SOURCES,
    };
  });

  app.get("/api/v1/agents/:id", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .limit(1);
    if (!agent) return reply.code(404).send({ error: `Agent ${id} was not found in this workspace.` });
    const folders = await db.select().from(agentFolders).where(eq(agentFolders.agentId, id));
    return {
      ...agent,
      knowledgeFolderIds: folders.map((f) => f.folderId),
      temperature: agent.settings?.temperature ?? (agent.temperature != null ? agent.temperature / 100 : null),
      maxOutputTokens: agent.settings?.maxOutputTokens ?? null,
      waitForCaller: agent.settings?.waitForCaller ?? false,
      enableEndCall: agent.settings?.enableEndCall ?? true,
      enableDtmf: agent.settings?.enableDtmf ?? false,
    };
  });

  app.post("/api/v1/agents", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = agentConfigSchema.parse({ ...req.body as object, modelId: resolveModelId((req.body as { modelId?: string }).modelId) });
    const templated = applyTemplate(parsed.template, parsed.instructions, parsed.waitForCaller ? null : parsed.initialMessage);
    const apiKey = await orgApiKey(org.organizationId);
    const settings = {
      temperature: parsed.temperature ?? null,
      maxOutputTokens: parsed.maxOutputTokens ?? null,
      waitForCaller: Boolean(parsed.waitForCaller),
      enableEndCall: parsed.enableEndCall !== false,
      enableDtmf: Boolean(parsed.enableDtmf),
    };
    let cartesiaAgentId: string | null = null;
    let toolIds: string[] = [];
    if (cartesia.configured() || apiKey) {
      const provisioned = await provisionCartesiaAgent({
        organizationId: org.organizationId,
        name: parsed.name,
        instructions: templated.instructions,
        initialMessage: settings.waitForCaller ? null : templated.initialMessage,
        modelId: parsed.modelId,
        temperature: parsed.temperature,
        maxOutputTokens: parsed.maxOutputTokens,
        language: parsed.language,
        voiceId: parsed.voiceId,
        speed: parsed.speed != null ? String(parsed.speed) : null,
        volume: parsed.volume != null ? String(parsed.volume) : null,
        emotion: parsed.emotion,
        noiseSuppression: parsed.noiseSuppression,
        keyterms: parsed.keyterms,
        transferRules: parsed.transferRules,
        toolIds: [],
        enableEndCall: settings.enableEndCall,
        enableDtmf: settings.enableDtmf,
      }, apiKey);
      cartesiaAgentId = provisioned.cartesiaAgentId;
      toolIds = provisioned.toolIds;
    }
    const [row] = await db
      .insert(agents)
      .values({
        organizationId: org.organizationId,
        cartesiaAgentId,
        name: parsed.name,
        description: parsed.description ?? null,
        instructions: templated.instructions,
        initialMessage: templated.initialMessage,
        modelId: parsed.modelId,
        language: parsed.language,
        voiceId: parsed.voiceId,
        speed: parsed.speed != null ? String(parsed.speed) : null,
        volume: parsed.volume != null ? String(parsed.volume) : null,
        emotion: parsed.emotion ?? null,
        noiseSuppression: parsed.noiseSuppression,
        keyterms: parsed.keyterms,
        maxCallDurationMinutes: parsed.maxCallDurationMinutes,
        transferRules: parsed.transferRules,
        template: parsed.template ?? "blank",
        cartesiaToolIds: toolIds,
        settings,
      })
      .returning();
    await syncFolderAccess(org.organizationId, row!.id, cartesiaAgentId, parsed.knowledgeFolderIds, apiKey);
    await audit(org, "create", "agent", row!.id, { name: parsed.name });
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/agents/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const parsed = agentConfigSchema.partial().extend({ name: agentConfigSchema.shape.name.optional() }).parse(req.body);
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Agent ${id} was not found in this workspace.` });
    const settings = {
      temperature: parsed.temperature ?? existing.settings?.temperature ?? null,
      maxOutputTokens: parsed.maxOutputTokens ?? existing.settings?.maxOutputTokens ?? null,
      waitForCaller: parsed.waitForCaller ?? existing.settings?.waitForCaller ?? false,
      enableEndCall: parsed.enableEndCall ?? existing.settings?.enableEndCall ?? true,
      enableDtmf: parsed.enableDtmf ?? existing.settings?.enableDtmf ?? false,
    };
    const merged = {
      ...existing,
      ...parsed,
      modelId: resolveModelId(parsed.modelId ?? existing.modelId),
      keyterms: parsed.keyterms ?? existing.keyterms,
      transferRules: parsed.transferRules ?? existing.transferRules,
      initialMessage: settings.waitForCaller ? null : (parsed.initialMessage ?? existing.initialMessage),
    };
    const apiKey = await orgApiKey(org.organizationId);
    let cartesiaAgentId = existing.cartesiaAgentId;
    let toolIds = existing.cartesiaToolIds ?? [];
    if (cartesia.configured() || apiKey) {
      const cartesiaInput = {
        organizationId: org.organizationId,
        name: merged.name,
        instructions: merged.instructions,
        initialMessage: merged.initialMessage,
        modelId: merged.modelId,
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
        language: merged.language,
        voiceId: merged.voiceId,
        speed: merged.speed != null ? String(merged.speed) : null,
        volume: merged.volume != null ? String(merged.volume) : null,
        emotion: merged.emotion,
        noiseSuppression: (merged.noiseSuppression as "off" | "auto" | "max") ?? "auto",
        keyterms: merged.keyterms ?? [],
        transferRules: merged.transferRules ?? [],
        toolIds,
        enableEndCall: settings.enableEndCall,
        enableDtmf: settings.enableDtmf,
      };
      if (existing.cartesiaAgentId) {
        await cartesia.updateAgent(existing.cartesiaAgentId, toCartesiaAgent(cartesiaInput), apiKey);
        const webhookId = await ensureCartesiaWebhook(apiKey).catch(() => null);
        if (webhookId) await cartesia.attachCallWebhook(existing.cartesiaAgentId, webhookId, apiKey).catch(() => undefined);
      } else {
        const provisioned = await provisionCartesiaAgent(cartesiaInput, apiKey);
        cartesiaAgentId = provisioned.cartesiaAgentId;
        toolIds = provisioned.toolIds;
      }
    }
    const [row] = await db
      .update(agents)
      .set({
        name: merged.name,
        description: merged.description,
        instructions: merged.instructions,
        initialMessage: merged.initialMessage,
        modelId: merged.modelId,
        language: merged.language,
        voiceId: merged.voiceId,
        speed: parsed.speed != null ? String(parsed.speed) : existing.speed,
        volume: parsed.volume != null ? String(parsed.volume) : existing.volume,
        emotion: merged.emotion,
        noiseSuppression: merged.noiseSuppression,
        keyterms: merged.keyterms,
        maxCallDurationMinutes: merged.maxCallDurationMinutes,
        transferRules: merged.transferRules,
        cartesiaAgentId,
        cartesiaToolIds: toolIds,
        settings,
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .returning();
    if (parsed.knowledgeFolderIds) {
      await syncFolderAccess(org.organizationId, id, cartesiaAgentId, parsed.knowledgeFolderIds, apiKey);
    }
    await audit(org, "update", "agent", id);
    return row;
  });

  app.delete("/api/v1/agents/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Agent ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaAgentId) {
      await cartesia.deleteAgent(existing.cartesiaAgentId, apiKey).catch(() => undefined);
    }
    await db.delete(agents).where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)));
    await audit(org, "delete", "agent", id);
    return { ok: true };
  });

  app.post("/api/v1/agents/:id/preview-token", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .limit(1);
    if (!agent) return reply.code(404).send({ error: `Agent ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (!cartesia.configured() && !apiKey) {
      return { token: null, agentId: agent.cartesiaAgentId, configured: false };
    }
    const token = await cartesia.createAccessToken({ agents: true }, 600, apiKey).catch(() => null);
    return { token: token?.token ?? null, agentId: agent.cartesiaAgentId, configured: true };
  });
}
