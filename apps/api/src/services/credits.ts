import { and, desc, eq, sql } from "drizzle-orm";
import { creditLedger, creditReservations, organizations } from "@dialix/db";
import { creditsForSeconds, reserveCredits } from "@dialix/shared";
import { db } from "../db.js";
import { httpError } from "../http.js";

export async function getBalance(organizationId: string): Promise<number> {
  const [row] = await db
    .select({
      sum: sql<number>`coalesce(sum(${creditLedger.amount}), 0)`,
    })
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, organizationId));
  return Number(row?.sum ?? 0);
}

export async function appendLedger(input: {
  organizationId: string;
  type: "purchase" | "reserve" | "capture" | "release" | "adjust";
  amount: number;
  cartesiaCallId?: string | null;
  stripeSessionId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
}) {
  const balance = await getBalance(input.organizationId);
  const balanceAfter = balance + input.amount;
  if (balanceAfter < 0 && input.type !== "reserve") {
    throw httpError(
      402,
      `Not enough credits to post this ledger entry. Balance is ${balance} credits; this change is ${input.amount}. Buy a pack in Billing.`,
    );
  }
  const [row] = await db
    .insert(creditLedger)
    .values({
      organizationId: input.organizationId,
      type: input.type,
      amount: input.amount,
      balanceAfter,
      cartesiaCallId: input.cartesiaCallId ?? null,
      stripeSessionId: input.stripeSessionId ?? null,
      description: input.description,
      metadata: input.metadata ?? {},
    })
    .returning();
  return row!;
}

export async function reserveForCall(input: {
  organizationId: string;
  cartesiaCallId?: string | null;
  maxCallDurationMinutes: number;
  useTelephonyAddon: boolean;
  description?: string;
}) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!org) throw httpError(404, "Workspace not found. Refresh and select an organization from the sidebar.");
  const amount = reserveCredits(
    input.maxCallDurationMinutes,
    org.creditRatePerSecond,
    org.telephonyCreditRatePerSecond,
    input.useTelephonyAddon,
  );
  const balance = await getBalance(input.organizationId);
  if (balance < amount) {
    throw httpError(
      402,
      `Not enough credits to start this call. Need ${amount} credits reserved (${input.maxCallDurationMinutes || 3} min at this workspace rate) but the balance is ${balance}. Buy a pack in Billing before dialing.`,
    );
  }
  await appendLedger({
    organizationId: input.organizationId,
    type: "reserve",
    amount: -amount,
    cartesiaCallId: input.cartesiaCallId,
    description: input.description ?? "Call credit reservation",
  });
  const [reservation] = await db
    .insert(creditReservations)
    .values({
      organizationId: input.organizationId,
      cartesiaCallId: input.cartesiaCallId,
      amount,
      status: "open",
    })
    .returning();
  return reservation!;
}

export async function settleCall(input: {
  organizationId: string;
  cartesiaCallId: string;
  durationSeconds: number;
  useTelephonyAddon: boolean;
}) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!org) return;
  const [reservation] = await db
    .select()
    .from(creditReservations)
    .where(
      and(
        eq(creditReservations.organizationId, input.organizationId),
        eq(creditReservations.cartesiaCallId, input.cartesiaCallId),
      ),
    )
    .limit(1);
  const actual = creditsForSeconds(
    input.durationSeconds,
    org.creditRatePerSecond,
    org.telephonyCreditRatePerSecond,
    input.useTelephonyAddon,
  );
  if (!reservation) {
    await appendLedger({
      organizationId: input.organizationId,
      type: "capture",
      amount: -actual,
      cartesiaCallId: input.cartesiaCallId,
      description: "Call usage",
    }).catch(() => undefined);
    return actual;
  }
  if (reservation.status !== "open") return reservation.capturedAmount;
  const unused = Math.max(0, reservation.amount - actual);
  if (unused > 0) {
    await appendLedger({
      organizationId: input.organizationId,
      type: "release",
      amount: unused,
      cartesiaCallId: input.cartesiaCallId,
      description: "Unused reservation released",
    }).catch(() => undefined);
  }
  await db
    .update(creditReservations)
    .set({ status: "captured", capturedAmount: actual, updatedAt: new Date() })
    .where(eq(creditReservations.id, reservation.id));
  return actual;
}

export async function listLedger(organizationId: string, limit = 50) {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.organizationId, organizationId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(limit);
}
