export type ContactRecord = {
  id?: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  raw?: unknown;
};

export type CallLogInput = {
  phone?: string | null;
  direction: string;
  durationSeconds: number;
  summary?: string | null;
  transcript?: unknown;
  startedAt?: Date | null;
  endedAt?: Date | null;
};

export type AvailabilitySlot = {
  start: string;
  end: string;
};

export type AppointmentInput = {
  title: string;
  start: string;
  end: string;
  timezone?: string;
  attendeeEmail?: string | null;
  attendeeName?: string | null;
  notes?: string | null;
};

export type CrmConnector = {
  lookupContact(phone: string): Promise<ContactRecord | null>;
  upsertContact(contact: ContactRecord): Promise<ContactRecord>;
  logCall(input: CallLogInput): Promise<void>;
};

export type CalendarConnector = {
  listAvailability(start: string, end: string, durationMinutes: number): Promise<AvailabilitySlot[]>;
  createAppointment(input: AppointmentInput): Promise<{ id: string }>;
  updateAppointment(id: string, input: Partial<AppointmentInput>): Promise<void>;
  cancelAppointment(id: string): Promise<void>;
};
