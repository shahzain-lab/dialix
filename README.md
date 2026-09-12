# Dialix

Multi-tenant voice agent platform. Clients log into an isolated workspace, create Cartesia Managed Agents, attach knowledge and phone numbers, run inbound/outbound calling, book appointments, and buy prepaid credits.

Dialix is the control plane. **Cartesia** is the voice/telephony engine. Clients never receive the platform Cartesia API key.

## Stack

- Vite + React + TypeScript dashboard
- Fastify API
- PostgreSQL (Drizzle + row-level security policies)
- Redis + BullMQ
- Stripe credits
- Cartesia Managed Agents, telephony, knowledge base, and webhooks

## Local setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:3001/api/health

Create an account at `/signup`. Each signup gets its own organization, membership, and knowledge-base root folder.

## Environment

Copy `.env.example`. Minimum for local auth:

- `DATABASE_URL`
- `REDIS_URL`
- `BETTER_AUTH_SECRET` (32+ characters)
- `ENCRYPTION_KEY`

For live calling set `CARTESIA_API_KEY` and `CARTESIA_WEBHOOK_SECRET`, and point `PUBLIC_API_URL` at a public HTTPS URL Cartesia can reach (webhooks + agent tools). Stripe, Google, Microsoft, and HubSpot keys enable billing and OAuth integrations.

Without Cartesia keys the dashboard still works: agents, contacts, credits (dev grants), and knowledge save locally.

## Isolation

Every domain table is scoped by `organization_id`. The API never proxies Cartesia list endpoints to the browser. Knowledge folders are created per org (`dialix_{orgId}`) and attached only to that org’s agents.

## Credits

1 Dialix credit = 1 second of billed agent time. Org `credit_rate_per_second` (default 2) is the markup. Cartesia-provisioned numbers add `telephony_credit_rate_per_second`. Outbound and campaigns reserve `max(max_call_duration, 3 minutes)` before dialing; webhooks capture actual duration.

## Railway

This repo is set up as a single service that serves the Vite build from Fastify in production:

1. Provision Postgres and Redis plugins
2. Set env vars from `.env.example`
3. Build: `pnpm install && pnpm build && pnpm db:migrate`
4. Start: `pnpm --filter @dialix/api start`

Webhook URL: `https://<your-domain>/internal/cartesia/events`  
Tool base: `https://<your-domain>/internal/tools`
