import type { CalendarConnector, AppointmentInput, AvailabilitySlot } from "./types.js";

type Tokens = { access_token: string; refresh_token?: string; expires_at?: number };

async function googleFetch(tokens: Tokens, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Google Calendar ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

export function googleCalendar(tokens: Tokens): CalendarConnector {
  return {
    async listAvailability(start, end, durationMinutes): Promise<AvailabilitySlot[]> {
      const body = {
        timeMin: start,
        timeMax: end,
        items: [{ id: "primary" }],
      };
      const data = (await googleFetch(tokens, "/freeBusy", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } } };
      const busy = data.calendars?.primary?.busy ?? [];
      const slots: AvailabilitySlot[] = [];
      let cursor = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const dur = durationMinutes * 60_000;
      const busyMs = busy.map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }));
      while (cursor + dur <= endMs) {
        const next = cursor + dur;
        const overlaps = busyMs.some((b) => cursor < b.e && next > b.s);
        if (!overlaps) slots.push({ start: new Date(cursor).toISOString(), end: new Date(next).toISOString() });
        cursor += 30 * 60_000;
        if (slots.length >= 12) break;
      }
      return slots;
    },
    async createAppointment(input: AppointmentInput) {
      const data = (await googleFetch(tokens, "/calendars/primary/events", {
        method: "POST",
        body: JSON.stringify({
          summary: input.title,
          description: input.notes ?? "",
          start: { dateTime: input.start, timeZone: input.timezone ?? "UTC" },
          end: { dateTime: input.end, timeZone: input.timezone ?? "UTC" },
          attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : [],
        }),
      })) as { id: string };
      return { id: data.id };
    },
    async updateAppointment(id, input) {
      await googleFetch(tokens, `/calendars/primary/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          summary: input.title,
          description: input.notes,
          start: input.start ? { dateTime: input.start, timeZone: input.timezone ?? "UTC" } : undefined,
          end: input.end ? { dateTime: input.end, timeZone: input.timezone ?? "UTC" } : undefined,
        }),
      });
    },
    async cancelAppointment(id) {
      await googleFetch(tokens, `/calendars/primary/events/${id}`, { method: "DELETE" });
    },
  };
}

async function graphFetch(tokens: Tokens, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Microsoft Graph ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

export function microsoftCalendar(tokens: Tokens): CalendarConnector {
  return {
    async listAvailability(start, end, durationMinutes) {
      const data = (await graphFetch(tokens, "/me/calendar/getSchedule", {
        method: "POST",
        body: JSON.stringify({
          schedules: ["me"],
          startTime: { dateTime: start, timeZone: "UTC" },
          endTime: { dateTime: end, timeZone: "UTC" },
          availabilityViewInterval: 30,
        }),
      })) as { value?: Array<{ scheduleItems?: Array<{ start: { dateTime: string }; end: { dateTime: string } }> }> };
      const busy = data.value?.[0]?.scheduleItems ?? [];
      const slots: AvailabilitySlot[] = [];
      let cursor = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const dur = durationMinutes * 60_000;
      const busyMs = busy.map((b) => ({
        s: new Date(b.start.dateTime).getTime(),
        e: new Date(b.end.dateTime).getTime(),
      }));
      while (cursor + dur <= endMs) {
        const next = cursor + dur;
        const overlaps = busyMs.some((b) => cursor < b.e && next > b.s);
        if (!overlaps) slots.push({ start: new Date(cursor).toISOString(), end: new Date(next).toISOString() });
        cursor += 30 * 60_000;
        if (slots.length >= 12) break;
      }
      return slots;
    },
    async createAppointment(input) {
      const data = (await graphFetch(tokens, "/me/events", {
        method: "POST",
        body: JSON.stringify({
          subject: input.title,
          body: { contentType: "text", content: input.notes ?? "" },
          start: { dateTime: input.start, timeZone: input.timezone ?? "UTC" },
          end: { dateTime: input.end, timeZone: input.timezone ?? "UTC" },
          attendees: input.attendeeEmail
            ? [{ emailAddress: { address: input.attendeeEmail, name: input.attendeeName ?? "" }, type: "required" }]
            : [],
        }),
      })) as { id: string };
      return { id: data.id };
    },
    async updateAppointment(id, input) {
      await graphFetch(tokens, `/me/events/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subject: input.title,
          start: input.start ? { dateTime: input.start, timeZone: input.timezone ?? "UTC" } : undefined,
          end: input.end ? { dateTime: input.end, timeZone: input.timezone ?? "UTC" } : undefined,
        }),
      });
    },
    async cancelAppointment(id) {
      await graphFetch(tokens, `/me/events/${id}`, { method: "DELETE" });
    },
  };
}
