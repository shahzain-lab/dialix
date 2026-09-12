import {
  APPOINTMENT_SETTER_GREETING,
  APPOINTMENT_SETTER_INSTRUCTIONS,
  SUPPORT_GREETING,
  SUPPORT_INSTRUCTIONS,
  cartesiaResourceName,
} from "@dialix/shared";
import type { ManagedAgentConfig } from "../integrations/cartesia/client.js";
import { env } from "../env.js";

export function applyTemplate(template: string | undefined, instructions: string, greeting?: string | null) {
  if (template === "appointment_setter") {
    return {
      instructions: instructions || APPOINTMENT_SETTER_INSTRUCTIONS,
      initialMessage: greeting || APPOINTMENT_SETTER_GREETING,
    };
  }
  if (template === "support") {
    return {
      instructions: instructions || SUPPORT_INSTRUCTIONS,
      initialMessage: greeting || SUPPORT_GREETING,
    };
  }
  return { instructions, initialMessage: greeting ?? null };
}

export function toCartesiaAgent(input: {
  organizationId: string;
  name: string;
  instructions: string;
  initialMessage?: string | null;
  modelId: string;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  language: string;
  voiceId: string;
  speed?: string | null;
  volume?: string | null;
  emotion?: string | null;
  noiseSuppression: "off" | "auto" | "max";
  keyterms: string[];
  transferRules: Array<{ destination: string; type: "phone" | "sip_uri"; condition: string }>;
  toolIds: string[];
  enableEndCall?: boolean;
  enableDtmf?: boolean;
  webhookId?: string | null;
}): ManagedAgentConfig {
  return {
    name: cartesiaResourceName(input.organizationId, input.name),
    webhook_id: input.webhookId ?? undefined,
    config: {
      instructions: input.instructions,
      initial_message: input.initialMessage ?? null,
      model: {
        id: input.modelId,
        temperature: input.temperature ?? null,
        max_output_tokens: input.maxOutputTokens ?? null,
      },
      language: { primary: input.language },
      audio: {
        input: {
          noise_suppression: input.noiseSuppression,
          keyterms: input.keyterms,
        },
        output: {
          voice_id: input.voiceId,
          speed: input.speed ? Number(input.speed) : null,
          volume: input.volume ? Number(input.volume) : null,
          emotion: input.emotion ?? null,
        },
      },
      tools: input.toolIds.map((id) => ({ id })),
      system_tools: {
        end_call: input.enableEndCall === false ? null : { description: null, pre_tool_speech: "force" },
        send_dtmf: input.enableDtmf ? { description: "Send keypad tones when the caller needs an IVR or extension.", pre_tool_speech: "auto" } : null,
        transfer_to_number: input.transferRules.length
          ? {
              description: null,
              pre_tool_speech: "auto",
              transfers: input.transferRules.map((rule) => ({
                destination:
                  rule.type === "sip_uri"
                    ? { type: "sip_uri" as const, sip_uri: rule.destination }
                    : { type: "phone" as const, phone_number: rule.destination },
                condition: rule.condition,
              })),
            }
          : null,
      },
    },
  };
}

export function toolDefinitions(organizationId: string) {
  const base = `${env.PUBLIC_API_URL.replace(/\/$/, "")}/internal/tools`;
  const header = { "X-Dialix-Organization": { type: "secret", secret_value: organizationId } };
  return [
    {
      type: "webhook",
      name: "check_availability",
      description: "Look up open appointment slots. Use before offering times.",
      api_schema: {
        url: `${base}/calendar/availability`,
        method: "POST",
        request_headers: header,
        request_body_schema: {
          type: "object",
          properties: {
            start: { type: "string", description: "ISO start of search window" },
            end: { type: "string", description: "ISO end of search window" },
            durationMinutes: { type: "number", description: "Meeting length in minutes" },
          },
        },
      },
    },
    {
      type: "webhook",
      name: "book_slot",
      description: "Book a confirmed appointment on the calendar.",
      api_schema: {
        url: `${base}/calendar/book`,
        method: "POST",
        request_headers: header,
        request_body_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            start: { type: "string" },
            end: { type: "string" },
            attendeeEmail: { type: "string" },
            attendeeName: { type: "string" },
            attendeePhone: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
    {
      type: "webhook",
      name: "cancel_appointment",
      description: "Cancel an existing appointment by id.",
      api_schema: {
        url: `${base}/calendar/cancel`,
        method: "POST",
        request_headers: header,
        request_body_schema: {
          type: "object",
          properties: { appointmentId: { type: "string" } },
        },
      },
    },
    {
      type: "webhook",
      name: "lookup_contact",
      description: "Look up a CRM contact by phone number.",
      api_schema: {
        url: `${base}/crm/lookup`,
        method: "POST",
        request_headers: header,
        request_body_schema: {
          type: "object",
          properties: { phone: { type: "string" } },
        },
      },
    },
    {
      type: "webhook",
      name: "upsert_contact",
      description: "Create or update a CRM contact.",
      api_schema: {
        url: `${base}/crm/upsert`,
        method: "POST",
        request_headers: header,
        request_body_schema: {
          type: "object",
          properties: {
            phone: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            email: { type: "string" },
            company: { type: "string" },
          },
        },
      },
    },
  ];
}
