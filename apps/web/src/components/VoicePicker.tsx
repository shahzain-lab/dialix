import { useMemo, useState } from "react";
import { AGENT_LANGUAGES, VOICE_GENDERS } from "@dialix/shared";
import { playApiAudio } from "../lib/api";
import { errorMessage, useToast } from "../lib/toast";
import { Badge, Button, Card, Input, Select } from "./ui";

export type CatalogVoice = {
  id: string;
  name: string;
  tagline?: string;
  description?: string;
  gender?: string | null;
  language?: string;
  accents?: Array<{ accent: string; locale: string; is_native: boolean }>;
  isOwner?: boolean;
  previewAvailable?: boolean;
};

export function VoicePicker({
  voices,
  selectedId,
  onSelect,
  onLoadMore,
  hasMore,
  loadingMore,
  search,
  onSearch,
  language,
  onLanguage,
  gender,
  onGender,
}: {
  voices: CatalogVoice[];
  selectedId?: string;
  onSelect: (voice: CatalogVoice) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  search: string;
  onSearch: (value: string) => void;
  language: string;
  onLanguage: (value: string) => void;
  gender: string;
  onGender: (value: string) => void;
}) {
  const toast = useToast();
  const [playing, setPlaying] = useState<string | null>(null);

  async function preview(id: string) {
    setPlaying(id);
    try {
      await playApiAudio(`/api/v1/voices/${id}/preview`);
    } catch (err) {
      toast.error("Preview failed", errorMessage(err, "Cartesia must be connected to play this voice."));
    } finally {
      setPlaying(null);
    }
  }

  const items = useMemo(() => voices, [voices]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input placeholder="Search voices" value={search} onChange={(e) => onSearch(e.target.value)} />
        <Select value={language} onChange={(e) => onLanguage(e.target.value)}>
          <option value="">All languages</option>
          {AGENT_LANGUAGES.map((lang) => (
            <option key={lang.id} value={lang.id}>{lang.label}</option>
          ))}
        </Select>
        <Select value={gender} onChange={(e) => onGender(e.target.value)}>
          {VOICE_GENDERS.map((g) => (
            <option key={g.id} value={g.id}>{g.label}</option>
          ))}
        </Select>
      </div>
      <div className="grid max-h-[28rem] gap-3 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
        {items.map((voice) => {
          const selected = selectedId === voice.id;
          return (
            <Card key={voice.id} className={`p-4 ${selected ? "border-accent/70 ring-1 ring-accent/40" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{voice.name}</div>
                  <div className="truncate text-xs text-mist-400">{voice.tagline || voice.language}</div>
                </div>
                {voice.isOwner ? <Badge>clone</Badge> : <Badge tone="good">library</Badge>}
              </div>
              {voice.accents?.length ? (
                <p className="mt-1 truncate text-[11px] text-mist-400">
                  {voice.gender ? `${voice.gender} · ` : ""}
                  {voice.accents.filter((a) => a.is_native).map((a) => a.locale).join(", ") || voice.language}
                </p>
              ) : null}
              {voice.description ? <p className="mt-2 line-clamp-2 text-xs text-mist-400">{voice.description}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" loading={playing === voice.id} onClick={() => preview(voice.id)}>
                  Preview
                </Button>
                <Button variant={selected ? "primary" : "outline"} onClick={() => onSelect(voice)}>
                  {selected ? "Selected" : "Use voice"}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
      {hasMore && onLoadMore ? (
        <Button variant="outline" className="w-full" loading={loadingMore} onClick={onLoadMore}>
          Load more voices
        </Button>
      ) : null}
    </div>
  );
}
