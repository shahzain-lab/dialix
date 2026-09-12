import { Queue, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import ioredis from "ioredis";
import { calls } from "@dialix/db";
import { env } from "./env.js";
import { db } from "./db.js";
import { getCrmConnector } from "./integrations/connectors.js";

const Redis = (ioredis as unknown as { default?: new (url: string, opts?: object) => unknown }).default ?? (ioredis as unknown as new (url: string, opts?: object) => unknown);

let connection: unknown = null;
let crmQueue: Queue | null = null;

function getConnection() {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });
  }
  return connection as import("bullmq").ConnectionOptions;
}

function getQueue() {
  if (!crmQueue) crmQueue = new Queue("crm-sync", { connection: getConnection() });
  return crmQueue;
}

async function syncCrm(organizationId: string, cartesiaCallId: string) {
  const [call] = await db.select().from(calls).where(eq(calls.cartesiaCallId, cartesiaCallId)).limit(1);
  if (!call) return;
  const crm = await getCrmConnector(organizationId);
  if (!crm) {
    await db.update(calls).set({ crmSyncStatus: "skipped" }).where(eq(calls.id, call.id));
    return;
  }
  await crm.connector.upsertContact({
    phone: call.direction === "outbound" ? call.toNumber : call.fromNumber,
  }).catch(() => undefined);
  await crm.connector.logCall({
    phone: call.direction === "outbound" ? call.toNumber : call.fromNumber,
    direction: call.direction,
    durationSeconds: call.durationSeconds,
    summary: call.summary,
    transcript: call.transcript,
    startedAt: call.startTime,
    endedAt: call.endTime,
  });
  await db.update(calls).set({ crmSyncStatus: "synced", updatedAt: new Date() }).where(eq(calls.id, call.id));
}

export async function enqueueCrmSync(organizationId: string, cartesiaCallId: string) {
  try {
    await getQueue().add("sync", { organizationId, cartesiaCallId }, { attempts: 3, backoff: { type: "exponential", delay: 2000 } });
  } catch {
    await syncCrm(organizationId, cartesiaCallId).catch(() => undefined);
  }
}

export function startWorker() {
  const worker = new Worker(
    "crm-sync",
    async (job) => {
      const { organizationId, cartesiaCallId } = job.data as { organizationId: string; cartesiaCallId: string };
      try {
        await syncCrm(organizationId, cartesiaCallId);
      } catch (err) {
        const [call] = await db.select().from(calls).where(eq(calls.cartesiaCallId, cartesiaCallId)).limit(1);
        if (call) await db.update(calls).set({ crmSyncStatus: "failed" }).where(eq(calls.id, call.id));
        throw err;
      }
    },
    { connection: getConnection() },
  );
  worker.on("failed", (job, err) => console.error("crm-sync failed", job?.id, err));
  return worker;
}
