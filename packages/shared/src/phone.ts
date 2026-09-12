const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizeE164(input: string): string {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  const only = trimmed.replace(/\D/g, "");
  if (only.length === 10) return `+1${only}`;
  if (only.length === 11 && only.startsWith("1")) return `+${only}`;
  return `+${only}`;
}

export function isE164(input: string): boolean {
  return E164.test(input);
}

export function assertE164(input: string): string {
  const value = normalizeE164(input);
  if (!isE164(value)) {
    throw new Error(
      `Phone number "${input}" is not valid E.164. Use country code, for example +14155551234.`,
    );
  }
  return value;
}

export function cartesiaResourceName(orgId: string, slug: string): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `dialix_${orgId.slice(0, 8)}_${safe || "resource"}`;
}
