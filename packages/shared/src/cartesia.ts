export const AGENT_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
  { id: "fr", label: "French" },
  { id: "de", label: "German" },
  { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" },
  { id: "nl", label: "Dutch" },
  { id: "ja", label: "Japanese" },
  { id: "ko", label: "Korean" },
  { id: "zh", label: "Chinese" },
  { id: "hi", label: "Hindi" },
  { id: "ar", label: "Arabic" },
  { id: "pl", label: "Polish" },
  { id: "ru", label: "Russian" },
  { id: "tr", label: "Turkish" },
  { id: "sv", label: "Swedish" },
  { id: "da", label: "Danish" },
  { id: "fi", label: "Finnish" },
  { id: "no", label: "Norwegian" },
  { id: "he", label: "Hebrew" },
  { id: "bn", label: "Bengali" },
  { id: "cs", label: "Czech" },
  { id: "el", label: "Greek" },
  { id: "hu", label: "Hungarian" },
  { id: "id", label: "Indonesian" },
  { id: "th", label: "Thai" },
  { id: "vi", label: "Vietnamese" },
  { id: "uk", label: "Ukrainian" },
] as const;

export const VOICE_GENDERS = [
  { id: "", label: "Any gender" },
  { id: "feminine", label: "Feminine" },
  { id: "masculine", label: "Masculine" },
  { id: "gender_neutral", label: "Neutral" },
] as const;

export const NOISE_SUPPRESSION = [
  { id: "auto", label: "Auto", hint: "Best for most phone lines" },
  { id: "max", label: "Max", hint: "Noisy rooms or mobile callers" },
  { id: "off", label: "Off", hint: "Keep raw caller audio" },
] as const;

export const AGENT_EMOTIONS = [
  "neutral",
  "calm",
  "content",
  "happy",
  "confident",
  "curious",
  "enthusiastic",
  "sympathetic",
  "apologetic",
  "serious",
  "sad",
] as const;

export const KNOWLEDGE_SOURCES = [
  {
    id: "text",
    label: "Paste text",
    accept: "",
    hint: "FAQs, policies, product copy. Cartesia indexes the text (max 1 MB).",
  },
  {
    id: "faq",
    label: "FAQ",
    accept: "",
    hint: "Question and answer pairs the agent can retrieve on the call.",
  },
  {
    id: "script",
    label: "Call script",
    accept: "",
    hint: "Opening lines, objections, and closing steps.",
  },
  {
    id: "policy",
    label: "Policy / terms",
    accept: "",
    hint: "Returns, hours, compliance language.",
  },
  {
    id: "file",
    label: "Upload file",
    accept: ".txt,.md,.csv,.json,.html,.htm",
    hint: "Plain text, Markdown, CSV, JSON, or HTML. PDFs are not indexed — paste the text instead.",
  },
  {
    id: "bulk",
    label: "Bulk files",
    accept: ".txt,.md,.csv,.json,.html,.htm",
    hint: "Upload many text files into the same folder in one step.",
  },
] as const;

export const CAMPAIGN_REGIONS = [
  { id: "US", label: "United States" },
] as const;

export const TTS_PREVIEW_MODELS = ["sonic-3.6", "sonic-latest"] as const;
export const DEFAULT_AGENT_MODEL = "claude-haiku-4.5";

export function formatFaqDocument(pairs: Array<{ q: string; a: string }>): string {
  return pairs
    .filter((row) => row.q.trim() && row.a.trim())
    .map((row, i) => `Q${i + 1}: ${row.q.trim()}\nA${i + 1}: ${row.a.trim()}`)
    .join("\n\n");
}
