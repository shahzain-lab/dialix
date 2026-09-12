import type { FastifyInstance } from "fastify";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { appointments, auditLog, calls, creditLedger } from "@dialix/db";
import { db } from "../db.js";
import { withOrg } from "../org.js";
import { getBalance } from "../services/credits.js";

export async function registerOverviewRoutes(app: FastifyInstance) {
  app.get("/api/v1/overview", async (req) => {
    const org = await withOrg(req);
    const balance = await getBalance(org.organizationId);
    const live = await db
      .select()
      .from(calls)
      .where(and(eq(calls.organizationId, org.organizationId), inArray(calls.status, ["queued", "ringing", "started"])));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const todayAppts = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.organizationId, org.organizationId), gte(appointments.startsAt, start)));
    const recentCalls = await db
      .select()
      .from(calls)
      .where(eq(calls.organizationId, org.organizationId))
      .orderBy(desc(calls.createdAt))
      .limit(8);
    const usage = await db
      .select({
        day: sql<string>`to_char(${calls.createdAt}, 'YYYY-MM-DD')`,
        seconds: sql<number>`coalesce(sum(${calls.durationSeconds}), 0)`,
        credits: sql<number>`coalesce(sum(${calls.creditsCharged}), 0)`,
      })
      .from(calls)
      .where(eq(calls.organizationId, org.organizationId))
      .groupBy(sql`to_char(${calls.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${calls.createdAt}, 'YYYY-MM-DD')`);
    return { balance, liveCalls: live.length, todayAppointments: todayAppts.length, recentCalls, usage };
  });

  app.get("/api/v1/analytics", async (req) => {
    const org = await withOrg(req);
    const byStatus = await db
      .select({
        status: calls.status,
        count: sql<number>`count(*)`,
      })
      .from(calls)
      .where(eq(calls.organizationId, org.organizationId))
      .groupBy(calls.status);
    const spend = await db
      .select({
        type: creditLedger.type,
        amount: sql<number>`coalesce(sum(${creditLedger.amount}), 0)`,
      })
      .from(creditLedger)
      .where(eq(creditLedger.organizationId, org.organizationId))
      .groupBy(creditLedger.type);
    return { byStatus, spend };
  });

  app.get("/api/v1/audit", async (req) => {
    const org = await withOrg(req);
    return db.select().from(auditLog).where(eq(auditLog.organizationId, org.organizationId)).orderBy(desc(auditLog.createdAt)).limit(100);
  });
}
