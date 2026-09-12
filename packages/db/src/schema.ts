import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const orgRoleEnum = pgEnum("org_role", ["owner", "admin", "operator", "viewer"]);
export const providerKindEnum = pgEnum("provider_kind", ["cartesia", "twilio", "sip_trunk"]);
export const callDirectionEnum = pgEnum("call_direction", ["inbound", "outbound", "preview"]);
export const callStatusEnum = pgEnum("call_status", [
  "queued",
  "ringing",
  "started",
  "completed",
  "failed",
  "canceled",
]);
export const ledgerTypeEnum = pgEnum("ledger_type", [
  "purchase",
  "reserve",
  "capture",
  "release",
  "adjust",
]);
export const integrationProviderEnum = pgEnum("integration_provider", [
  "hubspot",
  "google_calendar",
  "microsoft_365",
  "custom_crm",
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "running",
  "completed",
  "canceled",
  "failed",
]);
export const appointmentStatusEnum = pgEnum("appointment_status", [
  "booked",
  "rescheduled",
  "canceled",
  "completed",
  "no_show",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  creditRatePerSecond: integer("credit_rate_per_second").notNull().default(2),
  telephonyCreditRatePerSecond: integer("telephony_credit_rate_per_second").notNull().default(1),
  cartesiaApiKeyEncrypted: text("cartesia_api_key_encrypted"),
  defaultTransferNumber: text("default_transfer_number"),
  tcpaDisclaimer: text("tcpa_disclaimer"),
  stripeCustomerId: text("stripe_customer_id"),
  cartesiaRootFolderId: text("cartesia_root_folder_id"),
  cartesiaWebhookId: text("cartesia_webhook_id"),
  ...timestamps,
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: orgRoleEnum("role").notNull().default("owner"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: orgRoleEnum("role").notNull().default("operator"),
    token: text("token").notNull().unique(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("invites_org_idx").on(t.organizationId)],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cartesiaAgentId: text("cartesia_agent_id"),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    initialMessage: text("initial_message"),
    modelId: text("model_id").notNull().default("gpt-5.4-mini"),
    temperature: integer("temperature"),
    language: text("language").notNull().default("en"),
    voiceId: text("voice_id").notNull(),
    speed: text("speed"),
    volume: text("volume"),
    emotion: text("emotion"),
    noiseSuppression: text("noise_suppression").notNull().default("auto"),
    keyterms: jsonb("keyterms").$type<string[]>().notNull().default([]),
    maxCallDurationMinutes: integer("max_call_duration_minutes").notNull().default(10),
    transferRules: jsonb("transfer_rules")
      .$type<Array<{ destination: string; type: "phone" | "sip_uri"; condition: string }>>()
      .notNull()
      .default([]),
    template: text("template").notNull().default("blank"),
    cartesiaToolIds: jsonb("cartesia_tool_ids").$type<string[]>().notNull().default([]),
    ...timestamps,
  },
  (t) => [index("agents_org_idx").on(t.organizationId)],
);

export const kbFolders = pgTable(
  "kb_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    cartesiaFolderId: text("cartesia_folder_id"),
    name: text("name").notNull(),
    isRoot: boolean("is_root").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("kb_folders_org_idx").on(t.organizationId)],
);

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => kbFolders.id, { onDelete: "cascade" }),
    cartesiaDocumentId: text("cartesia_document_id"),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key"),
    content: text("content"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("kb_documents_org_idx").on(t.organizationId)],
);

export const agentFolders = pgTable(
  "agent_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id")
      .notNull()
      .references(() => kbFolders.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("agent_folders_unique").on(t.agentId, t.folderId)],
);

export const telephonyProviders = pgTable(
  "telephony_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: providerKindEnum("kind").notNull(),
    label: text("label").notNull(),
    cartesiaProviderId: text("cartesia_provider_id"),
    credentialsEncrypted: text("credentials_encrypted"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("telephony_providers_org_idx").on(t.organizationId)],
);

export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    providerId: uuid("provider_id").references(() => telephonyProviders.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    cartesiaNumberId: text("cartesia_number_id"),
    e164: text("e164").notNull(),
    label: text("label").notNull(),
    kind: providerKindEnum("kind").notNull().default("cartesia"),
    inboundEnabled: boolean("inbound_enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("phone_numbers_org_idx").on(t.organizationId),
    uniqueIndex("phone_numbers_org_e164").on(t.organizationId, t.e164),
  ],
);

export const voices = pgTable(
  "voices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cartesiaVoiceId: text("cartesia_voice_id").notNull(),
    name: text("name").notNull(),
    language: text("language"),
    isCloned: boolean("is_cloned").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("voices_org_idx").on(t.organizationId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    phone: text("phone").notNull(),
    email: text("email"),
    company: text("company"),
    timezone: text("timezone"),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    consentSource: text("consent_source"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("contacts_org_idx").on(t.organizationId),
    uniqueIndex("contacts_org_phone").on(t.organizationId, t.phone),
  ],
);

export const contactLists = pgTable(
  "contact_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => [index("contact_lists_org_idx").on(t.organizationId)],
);

export const contactListMembers = pgTable(
  "contact_list_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id")
      .notNull()
      .references(() => contactLists.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("contact_list_members_unique").on(t.listId, t.contactId)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    fromNumberId: uuid("from_number_id")
      .notNull()
      .references(() => phoneNumbers.id, { onDelete: "restrict" }),
    listId: uuid("list_id").references(() => contactLists.id, { onDelete: "set null" }),
    cartesiaBatchId: text("cartesia_batch_id"),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    targetConcurrency: integer("target_concurrency").notNull().default(5),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("campaigns_org_idx").on(t.organizationId)],
);

export const campaignRecipients = pgTable(
  "campaign_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    toNumber: text("to_number").notNull(),
    status: text("status").notNull().default("queued"),
    cartesiaCallId: text("cartesia_call_id"),
    errorMessage: text("error_message"),
    ...timestamps,
  },
  (t) => [index("campaign_recipients_campaign_idx").on(t.campaignId)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    phoneNumberId: uuid("phone_number_id").references(() => phoneNumbers.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    cartesiaCallId: text("cartesia_call_id").unique(),
    direction: callDirectionEnum("direction").notNull(),
    status: callStatusEnum("status").notNull().default("queued"),
    fromNumber: text("from_number"),
    toNumber: text("to_number"),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    endReason: text("end_reason"),
    summary: text("summary"),
    transcript: jsonb("transcript").$type<unknown[]>().notNull().default([]),
    recordingUrl: text("recording_url"),
    telephonyAccountType: text("telephony_account_type"),
    crmSyncStatus: text("crm_sync_status").notNull().default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("calls_org_idx").on(t.organizationId),
    index("calls_org_created_idx").on(t.organizationId, t.createdAt),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    callId: uuid("call_id").references(() => calls.id, { onDelete: "set null" }),
    calendarProvider: text("calendar_provider"),
    externalEventId: text("external_event_id"),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: appointmentStatusEnum("status").notNull().default("booked"),
    attendeeEmail: text("attendee_email"),
    attendeePhone: text("attendee_phone"),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => [index("appointments_org_idx").on(t.organizationId)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    status: text("status").notNull().default("disconnected"),
    tokensEncrypted: text("tokens_encrypted"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("integrations_org_provider").on(t.organizationId, t.provider)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: ledgerTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    cartesiaCallId: text("cartesia_call_id"),
    stripeSessionId: text("stripe_session_id"),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("credit_ledger_org_idx").on(t.organizationId),
    uniqueIndex("credit_ledger_call_type_idx").on(t.cartesiaCallId, t.type),
  ],
);

export const creditReservations = pgTable(
  "credit_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    cartesiaCallId: text("cartesia_call_id").unique(),
    amount: integer("amount").notNull(),
    capturedAmount: integer("captured_amount").notNull().default(0),
    status: text("status").notNull().default("open"),
    ...timestamps,
  },
  (t) => [index("credit_reservations_org_idx").on(t.organizationId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id"),
    source: text("source").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex("webhook_events_source_event").on(t.source, t.eventId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [index("audit_log_org_idx").on(t.organizationId)],
);

export const schema = {
  user,
  session,
  account,
  verification,
  organizations,
  memberships,
  invites,
  agents,
  kbFolders,
  kbDocuments,
  agentFolders,
  telephonyProviders,
  phoneNumbers,
  voices,
  contacts,
  contactLists,
  contactListMembers,
  campaigns,
  campaignRecipients,
  calls,
  appointments,
  integrations,
  creditLedger,
  creditReservations,
  webhookEvents,
  auditLog,
};
