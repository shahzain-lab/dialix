export const DEFAULT_CREDIT_RATE_PER_SECOND = 2;
export const DEFAULT_TELEPHONY_CREDIT_RATE_PER_SECOND = 1;
export const MIN_RESERVE_SECONDS = 180;

export const CREDIT_PACKS = [
  { id: "starter", name: "Starter", minutes: 500, credits: 500 * 60 },
  { id: "growth", name: "Growth", minutes: 2000, credits: 2000 * 60 },
  { id: "scale", name: "Scale", minutes: 10000, credits: 10000 * 60 },
] as const;

export function secondsFromDuration(
  startTime?: string | Date | null,
  endTime?: string | Date | null,
): number {
  if (!startTime || !endTime) return 0;
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(1, Math.ceil((end - start) / 1000));
}

export function creditsForSeconds(
  seconds: number,
  ratePerSecond: number,
  telephonyAddonPerSecond = 0,
  useTelephonyAddon = false,
): number {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const base = safeSeconds * ratePerSecond;
  const addon = useTelephonyAddon ? safeSeconds * telephonyAddonPerSecond : 0;
  return base + addon;
}

export function reserveCredits(
  maxCallDurationMinutes: number | null | undefined,
  ratePerSecond: number,
  telephonyAddonPerSecond = 0,
  useTelephonyAddon = false,
): number {
  const minutes = Math.max(3, maxCallDurationMinutes ?? 3);
  return creditsForSeconds(
    minutes * 60,
    ratePerSecond,
    telephonyAddonPerSecond,
    useTelephonyAddon,
  );
}

export function creditsToMinutes(credits: number, ratePerSecond: number): number {
  if (ratePerSecond <= 0) return 0;
  return credits / ratePerSecond / 60;
}
