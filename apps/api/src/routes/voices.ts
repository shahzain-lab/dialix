import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { TTS_PREVIEW_MODELS } from "@dialix/shared";
import { organizations, voices } from "@dialix/db";
import { db } from "../db.js";
import { assertWrite, audit, withOrg } from "../org.js";
import { cartesia, type CartesiaVoice } from "../integrations/cartesia/client.js";
import { decryptSecret } from "../crypto.js";

async function orgApiKey(organizationId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (org?.cartesiaApiKeyEncrypted) return decryptSecret(org.cartesiaApiKeyEncrypted);
  return undefined;
}

function publicVoice(voice: CartesiaVoice, clonedIds: Set<string>) {
  const owned = clonedIds.has(voice.id) || Boolean(voice.is_owner && clonedIds.has(voice.id));
  const catalog = voice.access === "public";
  if (!catalog && !clonedIds.has(voice.id)) return null;
  return {
    id: voice.id,
    name: voice.name || voice.id,
    tagline: voice.tagline || "",
    description: voice.description || "",
    gender: voice.gender ?? null,
    language: voice.language || voice.accents?.find((a) => a.is_native)?.locale?.slice(0, 2) || "en",
    accents: voice.accents ?? [],
    isOwner: owned,
    access: voice.access ?? "public",
    isPro: Boolean(voice.is_pro),
    previewAvailable: Boolean(voice.preview_file_url) || catalog,
  };
}

export async function registerVoiceRoutes(app: FastifyInstance) {
  app.get("/api/v1/voices", async (req) => {
    const org = await withOrg(req);
    const query = req.query as {
      q?: string;
      language?: string;
      gender?: string;
      starting_after?: string;
      limit?: string;
    };
    const cloned = await db.select().from(voices).where(eq(voices.organizationId, org.organizationId));
    const clonedIds = new Set(cloned.map((row) => row.cartesiaVoiceId));
    const apiKey = await orgApiKey(org.organizationId);
    let library: ReturnType<typeof publicVoice>[] = [];
    let hasMore = false;
    let nextPage: string | null = null;
    if (cartesia.configured() || apiKey) {
      const res = await cartesia
        .listVoices(apiKey, {
          q: query.q,
          language: query.language,
          gender: query.gender,
          starting_after: query.starting_after,
          limit: Math.min(100, Math.max(1, Number(query.limit) || 100)),
        })
        .catch(() => ({ data: [] as CartesiaVoice[], voices: [] as CartesiaVoice[], has_more: false, next_page: null as string | null }));
      const rows = Array.isArray(res) ? res : (res.data ?? res.voices ?? []);
      library = rows.map((voice: CartesiaVoice) => publicVoice(voice, clonedIds)).filter(Boolean);
      hasMore = Boolean((res as { has_more?: boolean }).has_more);
      nextPage = (res as { next_page?: string | null }).next_page ?? null;
    }
    return {
      library,
      cloned: cloned.map((row) => ({
        id: row.id,
        cartesiaVoiceId: row.cartesiaVoiceId,
        name: row.name,
        language: row.language,
        isCloned: true,
      })),
      hasMore,
      nextPage,
      configured: cartesia.configured() || Boolean(apiKey),
    };
  });

  app.get("/api/v1/voices/:id/preview", async (req, reply) => {
    const org = await withOrg(req);
    const { id } = req.params as { id: string };
    const apiKey = await orgApiKey(org.organizationId);
    if (!cartesia.configured() && !apiKey) {
      return reply.code(503).send({ error: "Cartesia is not connected. Add CARTESIA_API_KEY to preview voices." });
    }
    const cloned = await db.select().from(voices).where(eq(voices.organizationId, org.organizationId));
    const clonedIds = new Set(cloned.map((row) => row.cartesiaVoiceId));
    const voice = await cartesia.getVoice(id, apiKey).catch(() => null);
    if (voice && voice.access !== "public" && !clonedIds.has(id)) {
      return reply.code(404).send({ error: "That voice is not available in this workspace." });
    }
    if (voice?.preview_file_url) {
      const file = await cartesia.previewVoiceFile(voice.preview_file_url, apiKey);
      return reply.type(file.contentType).send(file.bytes);
    }
    const spoken = await cartesia.ttsBytes(
      {
        model_id: TTS_PREVIEW_MODELS[0],
        transcript: "Hi, this is a preview of how I will sound on your Dialix calls.",
        voice: { id },
        language: voice?.language || "en",
        output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
      },
      apiKey,
    );
    return reply.type(spoken.contentType).send(spoken.bytes);
  });

  app.post("/api/v1/voices/preview", async (req, reply) => {
    const org = await withOrg(req);
    const body = req.body as {
      voiceId: string;
      text?: string;
      language?: string;
      speed?: number;
      volume?: number;
      emotion?: string | null;
    };
    if (!body.voiceId) return reply.code(400).send({ error: "Choose a voice before generating a preview." });
    const apiKey = await orgApiKey(org.organizationId);
    if (!cartesia.configured() && !apiKey) {
      return reply.code(503).send({ error: "Cartesia is not connected. Add CARTESIA_API_KEY to preview speech." });
    }
    const transcript = (body.text || "Hi, thanks for calling. How can I help you today?").slice(0, 500);
    const spoken = await cartesia.ttsBytes(
      {
        model_id: TTS_PREVIEW_MODELS[0],
        transcript,
        voice: { id: body.voiceId },
        language: body.language || "en",
        output_format: { container: "wav", encoding: "pcm_s16le", sample_rate: 44100 },
        generation_config: {
          speed: body.speed ?? 1,
          volume: body.volume ?? 1,
          ...(body.emotion ? { emotion: body.emotion } : {}),
        },
      },
      apiKey,
    );
    return reply.type(spoken.contentType).send(spoken.bytes);
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
