import type { FastifyInstance } from "fastify";
import { CREDIT_PACKS } from "@dialix/shared";
import { organizations } from "@dialix/db";
import { eq } from "drizzle-orm";
import { env } from "../env.js";
import { db } from "../db.js";
import { assertAdmin, withOrg } from "../org.js";
import { getBalance, listLedger, appendLedger } from "../services/credits.js";
import { packFromPriceId, priceIdForPack, stripeClient } from "../integrations/stripe.js";

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get("/api/v1/billing", async (req) => {
    const org = await withOrg(req);
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, org.organizationId)).limit(1);
    const balance = await getBalance(org.organizationId);
    const ledger = await listLedger(org.organizationId);
    return {
      balance,
      minutes: organization ? balance / organization.creditRatePerSecond / 60 : 0,
      packs: CREDIT_PACKS,
      ledger,
      stripeConfigured: Boolean(env.STRIPE_SECRET_KEY),
    };
  });

  app.post("/api/v1/billing/checkout", async (req, reply) => {
    const org = await withOrg(req);
    assertAdmin(org.role);
    const body = req.body as { packId: string };
    const stripe = stripeClient();
    const pack = CREDIT_PACKS.find((p) => p.id === body.packId);
    if (!pack) return reply.code(400).send({ error: `Unknown credit pack "${body.packId}". Choose Starter, Growth, or Scale from Billing.` });
    if (!stripe) {
      await appendLedger({
        organizationId: org.organizationId,
        type: "purchase",
        amount: pack.credits,
        description: `Dev grant ${pack.name}`,
        metadata: { packId: pack.id, source: "dev" },
      });
      return { url: null, granted: pack.credits };
    }
    const price = priceIdForPack(pack.id);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${env.APP_URL}/billing?checkout=success`,
      cancel_url: `${env.APP_URL}/billing?checkout=cancel`,
      line_items: price ? [{ price, quantity: 1 }] : [{ price_data: { currency: "usd", product_data: { name: `Dialix ${pack.name}` }, unit_amount: pack.minutes * 20 }, quantity: 1 }],
      metadata: { organizationId: org.organizationId, packId: pack.id, credits: String(pack.credits) },
    });
    return { url: session.url };
  });

  app.post("/internal/stripe/webhook", async (req, reply) => {
    const stripe = stripeClient();
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ error: "Stripe not configured" });
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string") return reply.code(400).send({ error: "Missing signature" });
    const raw = (req as { rawBody?: Buffer }).rawBody;
    if (!raw) return reply.code(400).send({ error: "Missing body" });
    const event = stripe.webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const organizationId = session.metadata?.organizationId;
      const credits = Number(session.metadata?.credits ?? 0);
      if (organizationId && credits) {
        await appendLedger({
          organizationId,
          type: "purchase",
          amount: credits,
          stripeSessionId: session.id,
          description: "Stripe credit purchase",
        }).catch(() => undefined);
      }
    }
    return { received: true };
  });
}
