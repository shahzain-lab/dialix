export function localDateTimeToIso(value: string, label: string) {
  if (!value) throw new Error(`Choose a ${label}.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} "${value}" is not a valid date and time.`);
  }
  return parsed.toISOString();
}
