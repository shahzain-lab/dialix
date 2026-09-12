import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { agentConfigSchema } from "@dialix/shared";
import { agentFolders, agents, kbFolders, organizations } from "@dialix/db";
import { db } from "../db.js";
import { audit, assertWrite, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { applyTemplate, toCartesiaAgent, toolDefinitions } from "../services/agents.js";
import { decryptSecret } from "../crypto.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

async function ensureTools(organizationId: string, apiKey?: string) {
  if (!cartesia.configured() && !apiKey) return [];
  const ids: string[] = [];
  for (const tool of toolDefinitions(organizationId)) {
    const created = await cartesia.createTool(tool, apiKey);
    ids.push(created.id);
  }
  return ids;
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
    if (!cartesia.configured()) return { models: [{ id: "gpt-5.4-mini", provider: "openai" }] };
    return cartesia.listModels();
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
    return { ...agent, knowledgeFolderIds: folders.map((f) => f.folderId) };
  });

  app.post("/api/v1/agents", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const parsed = agentConfigSchema.parse(req.body);
    const templated = applyTemplate(parsed.template, parsed.instructions, parsed.initialMessage);
    const apiKey = await orgApiKey(org.organizationId);
    let cartesiaAgentId: string | null = null;
    let toolIds: string[] = [];
    try {
      toolIds = await ensureTools(org.organizationId, apiKey);
      const payload = toCartesiaAgent({
        organizationId: org.organizationId,
        name: parsed.name,
        instructions: templated.instructions,
        initialMessage: templated.initialMessage,
        modelId: parsed.modelId,
        temperature: parsed.temperature,
        language: parsed.language,
        voiceId: parsed.voiceId,
        speed: parsed.speed != null ? String(parsed.speed) : null,
        volume: parsed.volume != null ? String(parsed.volume) : null,
        emotion: parsed.emotion,
        noiseSuppression: parsed.noiseSuppression,
        keyterms: parsed.keyterms,
        transferRules: parsed.transferRules,
        toolIds,
      });
      if (cartesia.configured() || apiKey) {
        const created = await cartesia.createAgent(payload, apiKey);
        cartesiaAgentId = created.id;
      }
    } catch (err) {
      req.log.warn({ err }, "Cartesia agent create skipped or failed");
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
    const merged = {
      ...existing,
      ...parsed,
      keyterms: parsed.keyterms ?? existing.keyterms,
      transferRules: parsed.transferRules ?? existing.transferRules,
    };
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaAgentId && (cartesia.configured() || apiKey)) {
      const payload = toCartesiaAgent({
        organizationId: org.organizationId,
        name: merged.name,
        instructions: merged.instructions,
        initialMessage: merged.initialMessage,
        modelId: merged.modelId,
        language: merged.language,
        voiceId: merged.voiceId,
        speed: merged.speed != null ? String(merged.speed) : null,
        volume: merged.volume != null ? String(merged.volume) : null,
        emotion: merged.emotion,
        noiseSuppression: (merged.noiseSuppression as "off" | "auto" | "max") ?? "auto",
        keyterms: merged.keyterms ?? [],
        transferRules: merged.transferRules ?? [],
        toolIds: existing.cartesiaToolIds ?? [],
      });
      await cartesia.updateAgent(existing.cartesiaAgentId, payload, apiKey).catch((err) => req.log.warn({ err }, "Cartesia update failed"));
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
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, id), eq(agents.organizationId, org.organizationId)))
      .returning();
    if (parsed.knowledgeFolderIds) {
      await syncFolderAccess(org.organizationId, id, existing.cartesiaAgentId, parsed.knowledgeFolderIds, apiKey);
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
