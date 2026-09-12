import Stripe from "stripe";
import { CREDIT_PACKS } from "@dialix/shared";
import { env } from "../env.js";

export function stripeClient() {
  if (!env.STRIPE_SECRET_KEY) return null;
  return new Stripe(env.STRIPE_SECRET_KEY);
}

export function packFromPriceId(priceId: string) {
  const map: Record<string, (typeof CREDIT_PACKS)[number]> = {};
  if (env.STRIPE_PRICE_STARTER) map[env.STRIPE_PRICE_STARTER] = CREDIT_PACKS[0];
  if (env.STRIPE_PRICE_GROWTH) map[env.STRIPE_PRICE_GROWTH] = CREDIT_PACKS[1];
  if (env.STRIPE_PRICE_SCALE) map[env.STRIPE_PRICE_SCALE] = CREDIT_PACKS[2];
  return map[priceId];
}

export function priceIdForPack(packId: string) {
  if (packId === "starter") return env.STRIPE_PRICE_STARTER;
  if (packId === "growth") return env.STRIPE_PRICE_GROWTH;
  if (packId === "scale") return env.STRIPE_PRICE_SCALE;
  return "";
}
