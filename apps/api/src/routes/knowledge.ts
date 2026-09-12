import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { kbDocuments, kbFolders, organizations } from "@dialix/db";
import { cartesiaResourceName } from "@dialix/shared";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { decryptSecret } from "../crypto.js";
import { deleteFile, getFile, putFile } from "../storage.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

async function ensureRootFolder(organizationId: string, apiKey?: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  let [root] = await db
    .select()
    .from(kbFolders)
    .where(and(eq(kbFolders.organizationId, organizationId), eq(kbFolders.isRoot, true)))
    .limit(1);
  if (!root) {
    [root] = await db
      .insert(kbFolders)
      .values({ organizationId, name: `dialix_${organizationId.slice(0, 8)}`, isRoot: true })
      .returning();
  }
  if (!root!.cartesiaFolderId && (cartesia.configured() || apiKey)) {
    const created = await cartesia.createFolder(root!.name, null, apiKey).catch(() => null);
    if (created?.id) {
      await db.update(kbFolders).set({ cartesiaFolderId: created.id }).where(eq(kbFolders.id, root!.id));
      await db.update(organizations).set({ cartesiaRootFolderId: created.id }).where(eq(organizations.id, organizationId));
      root = { ...root!, cartesiaFolderId: created.id };
    }
  }
  return root!;
}

export async function registerKnowledgeRoutes(app: FastifyInstance) {
  app.get("/api/v1/knowledge/folders", async (req) => {
    const org = await withOrg(req);
    await ensureRootFolder(org.organizationId, await orgApiKey(org.organizationId));
    return db.select().from(kbFolders).where(eq(kbFolders.organizationId, org.organizationId));
  });

  app.post("/api/v1/knowledge/folders", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { name: string; parentId?: string | null };
    if (!body.name?.trim()) return reply.code(400).send({ error: "Give the knowledge folder a name." });
    const apiKey = await orgApiKey(org.organizationId);
    const root = await ensureRootFolder(org.organizationId, apiKey);
    const parentId = body.parentId ?? root.id;
    const [parent] = await db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, parentId), eq(kbFolders.organizationId, org.organizationId)))
      .limit(1);
    let cartesiaFolderId: string | null = null;
    if (cartesia.configured() || apiKey) {
      const created = await cartesia
        .createFolder(cartesiaResourceName(org.organizationId, body.name), parent?.cartesiaFolderId ?? root.cartesiaFolderId, apiKey)
        .catch(() => null);
      cartesiaFolderId = created?.id ?? null;
    }
    const [row] = await db
      .insert(kbFolders)
      .values({
        organizationId: org.organizationId,
        parentId,
        name: body.name,
        cartesiaFolderId,
      })
      .returning();
    await audit(org, "create", "kb_folder", row!.id);
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/knowledge/folders/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string };
    const [existing] = await db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, id), eq(kbFolders.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Folder ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaFolderId && body.name) {
      await cartesia.updateFolder(existing.cartesiaFolderId, { name: body.name }, apiKey).catch(() => undefined);
    }
    const [row] = await db
      .update(kbFolders)
      .set({ name: body.name ?? existing.name, updatedAt: new Date() })
      .where(eq(kbFolders.id, id))
      .returning();
    return row;
  });

  app.delete("/api/v1/knowledge/folders/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, id), eq(kbFolders.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Folder ${id} was not found in this workspace.` });
    if (existing.isRoot) return reply.code(400).send({ error: "The workspace root knowledge folder cannot be deleted." });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaFolderId) await cartesia.deleteFolder(existing.cartesiaFolderId, apiKey).catch(() => undefined);
    await db.delete(kbFolders).where(eq(kbFolders.id, id));
    await audit(org, "delete", "kb_folder", id);
    return { ok: true };
  });

  app.get("/api/v1/knowledge/documents", async (req) => {
    const org = await withOrg(req);
    const folderId = (req.query as { folderId?: string }).folderId;
    if (folderId) {
      return db
        .select()
        .from(kbDocuments)
        .where(and(eq(kbDocuments.organizationId, org.organizationId), eq(kbDocuments.folderId, folderId)));
    }
    return db.select().from(kbDocuments).where(eq(kbDocuments.organizationId, org.organizationId));
  });

  app.post("/api/v1/knowledge/documents", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { folderId: string; name: string; content: string; metadata?: Record<string, unknown> };
    const [folder] = await db
      .select()
      .from(kbFolders)
      .where(and(eq(kbFolders.id, body.folderId), eq(kbFolders.organizationId, org.organizationId)))
      .limit(1);
    if (!body.name?.trim()) return reply.code(400).send({ error: "Give the document a name." });
    if (!body.content?.trim()) return reply.code(400).send({ error: "Paste document content before saving. Empty documents cannot be indexed." });
    if (!folder) return reply.code(404).send({ error: "That knowledge folder is not in this workspace. Create or select a folder first." });
    const apiKey = await orgApiKey(org.organizationId);
    let cartesiaDocumentId: string | null = null;
    if (folder.cartesiaFolderId && (cartesia.configured() || apiKey)) {
      const created = await cartesia
        .createDocument({
          folder_id: folder.cartesiaFolderId,
          name: body.name,
          content: body.content,
          metadata: body.metadata ?? {},
        }, apiKey)
        .catch(() => null);
      cartesiaDocumentId = created?.id ?? null;
    }
    const storageKey = `${org.organizationId}/kb/${crypto.randomUUID()}.txt`;
    await putFile(storageKey, Buffer.from(body.content, "utf8"), "text/plain");
    const [row] = await db
      .insert(kbDocuments)
      .values({
        organizationId: org.organizationId,
        folderId: folder.id,
        cartesiaDocumentId,
        name: body.name,
        mimeType: "text/plain",
        storageKey,
        content: body.content,
        metadata: body.metadata ?? {},
      })
      .returning();
    await audit(org, "create", "kb_document", row!.id);
    return reply.code(201).send(row);
  });

  app.patch("/api/v1/knowledge/documents/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const body = req.body as { name?: string; content?: string };
    const [existing] = await db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Document ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaDocumentId) {
      await cartesia.updateDocument(existing.cartesiaDocumentId, { name: body.name, content: body.content }, apiKey).catch(() => undefined);
    }
    const [row] = await db
      .update(kbDocuments)
      .set({
        name: body.name ?? existing.name,
        content: body.content ?? existing.content,
        updatedAt: new Date(),
      })
      .where(eq(kbDocuments.id, id))
      .returning();
    return row;
  });

  app.delete("/api/v1/knowledge/documents/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Document ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    if (existing.cartesiaDocumentId) await cartesia.deleteDocument(existing.cartesiaDocumentId, apiKey).catch(() => undefined);
    if (existing.storageKey) await deleteFile(existing.storageKey);
    await db.delete(kbDocuments).where(eq(kbDocuments.id, id));
    await audit(org, "delete", "kb_document", id);
    return { ok: true };
  });

  app.get("/api/v1/knowledge/documents/:id/download", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.id, id), eq(kbDocuments.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Document ${id} was not found in this workspace.` });
    const buf = existing.storageKey ? await getFile(existing.storageKey).catch(() => Buffer.from(existing.content ?? "", "utf8")) : Buffer.from(existing.content ?? "", "utf8");
    reply.header("Content-Disposition", `attachment; filename="${existing.name}"`);
    return reply.type(existing.mimeType ?? "text/plain").send(buf);
  });
}
