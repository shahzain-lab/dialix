import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });
config();

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().default(Number(process.env.PORT ?? 3001)),
  APP_URL: z.string().default("http://localhost:5173"),
  API_URL: z.string().default("http://localhost:3001"),
  PUBLIC_API_URL: z.string().default("http://localhost:3001"),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().default("http://localhost:3001"),
  ENCRYPTION_KEY: z.string().min(16),
  CARTESIA_API_KEY: z.string().optional().default(""),
  CARTESIA_VERSION: z.string().default("2026-08-14"),
  CARTESIA_WEBHOOK_SECRET: z.string().optional().default(""),
  CARTESIA_WEBHOOK_ID: z.string().optional().default(""),
  CARTESIA_WEBHOOK_URL: z.string().optional().default(""),
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),
  STRIPE_PRICE_STARTER: z.string().optional().default(""),
  STRIPE_PRICE_GROWTH: z.string().optional().default(""),
  STRIPE_PRICE_SCALE: z.string().optional().default(""),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  MICROSOFT_CLIENT_ID: z.string().optional().default(""),
  MICROSOFT_CLIENT_SECRET: z.string().optional().default(""),
  MICROSOFT_TENANT_ID: z.string().optional().default("common"),
  HUBSPOT_CLIENT_ID: z.string().optional().default(""),
  HUBSPOT_CLIENT_SECRET: z.string().optional().default(""),
  S3_ENDPOINT: z.string().optional().default(""),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("dialix"),
  S3_ACCESS_KEY: z.string().optional().default(""),
  S3_SECRET_KEY: z.string().optional().default(""),
  UPLOAD_DIR: z.string().default("./data/uploads"),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
