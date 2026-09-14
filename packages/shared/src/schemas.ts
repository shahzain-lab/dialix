import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "operator", "viewer"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

export const writeRoles: OrgRole[] = ["owner", "admin", "operator"];
export const adminRoles: OrgRole[] = ["owner", "admin"];

export const signupSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  organizationName: z.string().min(1).max(120),
  inviteToken: z.string().optional(),
});

export const agentConfigSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  instructions: z.string().min(1),
  initialMessage: z.string().max(1000).optional().nullable(),
  modelId: z.string().min(1).default("claude-haiku-4.5"),
  temperature: z.number().min(0).max(1).optional().nullable(),
  maxOutputTokens: z.number().int().min(1).max(4096).optional().nullable(),
  language: z.string().min(2).max(8).default("en"),
  voiceId: z.string().min(1),
  speed: z.number().min(0.6).max(1.5).optional().nullable(),
  volume: z.number().min(0.5).max(2).optional().nullable(),
  emotion: z.string().optional().nullable(),
  waitForCaller: z.boolean().optional().default(false),
  enableEndCall: z.boolean().optional().default(true),
  enableDtmf: z.boolean().optional().default(false),
  noiseSuppression: z.enum(["off", "auto", "max"]).default("auto"),
  keyterms: z.array(z.string()).default([]),
  maxCallDurationMinutes: z.number().int().min(1).max(60).default(10),
  transferRules: z
    .array(
      z.object({
        destination: z.string().min(3),
        type: z.enum(["phone", "sip_uri"]).default("phone"),
        condition: z.string().min(1),
      }),
    )
    .default([]),
  knowledgeFolderIds: z.array(z.string().uuid()).default([]),
  template: z.enum(["blank", "appointment_setter", "support"]).optional(),
});

export const contactSchema = z.object({
  firstName: z.string().max(80).optional().nullable(),
  lastName: z.string().max(80).optional().nullable(),
  phone: z.string().min(7),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().email().optional().nullable()),
  company: z.string().max(160).optional().nullable(),
  timezone: z.string().max(80).optional().nullable(),
  consentAt: z.string().datetime().optional().nullable(),
  consentSource: z.string().max(160).optional().nullable(),
  metadata: z.record(z.unknown()).optional(),
});

export const campaignSchema = z.object({
  name: z.string().min(1).max(160),
  agentId: z.string().uuid(),
  fromNumberId: z.string().uuid(),
  listId: z.string().uuid().optional().nullable(),
  contactIds: z.array(z.string().uuid()).optional(),
  targetConcurrency: z.number().int().min(1).max(50).default(5),
  scheduledAt: z.string().datetime().optional().nullable(),
  region: z.enum(["US"]).optional().default("US"),
  ringingTimeoutSeconds: z.number().int().min(5).max(120).optional().nullable(),
  maxCallDurationMinutes: z.number().int().min(1).max(60).optional().nullable(),
});

export const customCrmConfigSchema = z.object({
  baseUrl: z.string().url(),
  authHeaderName: z.string().min(1).default("Authorization"),
  authHeaderValue: z.string().min(1),
  lookupPath: z.string().min(1).default("/contacts/lookup"),
  upsertPath: z.string().min(1).default("/contacts"),
  logCallPath: z.string().min(1).default("/calls"),
  phoneQueryParam: z.string().min(1).default("phone"),
});

export const sipProviderSchema = z.object({
  label: z.string().min(1).max(120),
  inboundUsername: z.string().optional(),
  inboundPassword: z.string().optional(),
  outboundAddress: z.string().min(1),
  outboundTransport: z.enum(["udp", "tcp", "tls"]).default("tls"),
  destinationCountry: z.string().min(2).max(2).default("US"),
  outboundUsername: z.string().optional(),
  outboundPassword: z.string().optional(),
  mediaEncryption: z.enum(["allowed", "required"]).default("allowed"),
});

export const twilioProviderSchema = z.object({
  label: z.string().min(1).max(120).default("Twilio"),
  accountSid: z.string().min(1),
  apiKeySid: z.string().min(1),
  apiKeySecret: z.string().min(1),
  region: z.enum(["us1", "ie1"]).default("us1"),
});
