import "dotenv/config";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env, isProd } from "./env.js";
import { HttpError } from "./http.js";
import { CartesiaError } from "./integrations/cartesia/client.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerVoiceRoutes } from "./routes/voices.js";
import { registerPhoneRoutes } from "./routes/phones.js";
import { registerContactRoutes } from "./routes/contacts.js";
import { registerCampaignRoutes } from "./routes/campaigns.js";
import { registerCallRoutes } from "./routes/calls.js";
import { registerAppointmentRoutes } from "./routes/appointments.js";
import { registerIntegrationRoutes } from "./routes/integrations.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerTeamRoutes } from "./routes/team.js";
import { registerOverviewRoutes } from "./routes/overview.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { startWorker } from "./queue.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: [env.APP_URL, env.API_URL],
  credentials: true,
});
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  (req as { rawBody?: Buffer }).rawBody = body as Buffer;
  if (req.url.startsWith("/api/auth")) {
    done(null, null);
    return;
  }
  try {
    const json = body.length ? JSON.parse((body as Buffer).toString("utf8")) : {};
    done(null, json);
  } catch (err) {
    done(err as Error);
  }
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const field = first?.path?.length ? first.path.join(".") : "request";
    return reply.code(400).send({
      error: `Invalid ${field}: ${first?.message ?? "check the submitted values."}`,
      details: err.issues,
    });
  }
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message, details: err.details });
  }
  if (err instanceof CartesiaError) {
    const status = err.status === 401 || err.status === 403 ? 502 : err.status >= 400 && err.status < 600 ? err.status : 502;
    return reply.code(status).send({ error: err.message, details: err.body });
  }
  if (err instanceof Error && err.message.includes("not valid E.164")) {
    return reply.code(400).send({ error: err.message });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  req.log.error(err);
  const message =
    err instanceof Error && status < 500
      ? err.message
      : "The Dialix API hit an unexpected error. Retry the action; if it continues, check API logs.";
  reply.code(status >= 400 ? status : 500).send({ error: message });
});

await registerAuthRoutes(app);
await registerAgentRoutes(app);
await registerKnowledgeRoutes(app);
await registerVoiceRoutes(app);
await registerPhoneRoutes(app);
await registerContactRoutes(app);
await registerCampaignRoutes(app);
await registerCallRoutes(app);
await registerAppointmentRoutes(app);
await registerIntegrationRoutes(app);
await registerBillingRoutes(app);
await registerTeamRoutes(app);
await registerOverviewRoutes(app);
await registerInternalRoutes(app);

const webDist = join(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
if (isProd && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api") || req.url.startsWith("/internal")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
}

try {
  startWorker();
} catch (err) {
  app.log.warn({ err }, "Worker not started (Redis may be unavailable)");
}

await app.listen({ host: env.API_HOST, port: env.API_PORT });
