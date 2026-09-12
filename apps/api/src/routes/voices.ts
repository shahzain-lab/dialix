import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { organizations, voices } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";
import { cartesia } from "../integrations/cartesia/client.js";
import { decryptSecret } from "../crypto.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

export async function registerVoiceRoutes(app: FastifyInstance) {
  app.get("/api/v1/voices", async (req) => {
    const org = await withOrg(req);
    const cloned = await db.select().from(voices).where(eq(voices.organizationId, org.organizationId));
    const apiKey = await orgApiKey(org.organizationId);
    let library: unknown[] = [];
    if (cartesia.configured() || apiKey) {
      const res = await cartesia.listVoices(apiKey).catch(() => ({ data: [] as unknown[] }));
      library = Array.isArray(res) ? res : ((res as { data?: unknown[]; voices?: unknown[] }).data ?? (res as { voices?: unknown[] }).voices ?? []);
    }
    return { library, cloned };
  });

  app.post("/api/v1/voices/clone", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const body = req.body as { name: string; language?: string; audioBase64: string; filename?: string };
    const apiKey = await orgApiKey(org.organizationId);
    if (!cartesia.configured() && !apiKey) {
      return reply.code(503).send({ error: "Cartesia is not connected. Add CARTESIA_API_KEY before cloning a voice." });
    }
    if (!body.audioBase64) return reply.code(400).send({ error: "Choose an audio file to clone. The upload did not include audio bytes." });
    if (!body.name?.trim()) return reply.code(400).send({ error: "Give the cloned voice a name." });
    const form = new FormData();
    form.append("name", body.name);
    if (body.language) form.append("language", body.language);
    const bin = Buffer.from(body.audioBase64, "base64");
    form.append("clip", new Blob([bin]), body.filename ?? "clone.wav");
    const created = await cartesia.cloneVoice(form, apiKey);
    const [row] = await db
      .insert(voices)
      .values({
        organizationId: org.organizationId,
        cartesiaVoiceId: created.id,
        name: created.name ?? body.name,
        language: body.language ?? null,
        isCloned: true,
      })
      .returning();
    await audit(org, "create", "voice", row!.id);
    return reply.code(201).send(row);
  });

  app.delete("/api/v1/voices/:id", async (req, reply) => {
    const org = await withOrg(req);
    assertWrite(org.role);
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select()
      .from(voices)
      .where(and(eq(voices.id, id), eq(voices.organizationId, org.organizationId)))
      .limit(1);
    if (!existing) return reply.code(404).send({ error: `Voice ${id} was not found in this workspace.` });
    const apiKey = await orgApiKey(org.organizationId);
    await cartesia.deleteVoice(existing.cartesiaVoiceId, apiKey).catch(() => undefined);
    await db.delete(voices).where(eq(voices.id, id));
    await audit(org, "delete", "voice", id);
    return { ok: true };
  });
}
