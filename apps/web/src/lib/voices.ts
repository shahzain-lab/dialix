import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import type { CatalogVoice } from "../components/VoicePicker";

export type VoicesResponse = {
  library: CatalogVoice[];
  cloned: Array<{ id: string; cartesiaVoiceId: string; name: string; language: string | null; isCloned?: boolean }>;
  hasMore: boolean;
  nextPage: string | null;
  configured: boolean;
};

export function useVoiceCatalog(filters: { search: string; language: string; gender: string }) {
  const { org } = useAuth();
  const query = useInfiniteQuery({
    queryKey: ["voices", org?.id, filters.search, filters.language, filters.gender],
    enabled: Boolean(org),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: "100" });
      if (filters.search) q.set("q", filters.search);
      if (filters.language) q.set("language", filters.language);
      if (filters.gender) q.set("gender", filters.gender);
      if (pageParam) q.set("starting_after", pageParam);
      return api<VoicesResponse>(`/api/v1/voices?${q}`);
    },
    getNextPageParam: (last) => (last.hasMore && last.nextPage ? last.nextPage : undefined),
  });

  const cloned = query.data?.pages[0]?.cloned ?? [];
  const seen = new Set<string>();
  const voices: CatalogVoice[] = [];
  for (const clone of cloned) {
    if (seen.has(clone.cartesiaVoiceId)) continue;
    seen.add(clone.cartesiaVoiceId);
    voices.push({
      id: clone.cartesiaVoiceId,
      name: clone.name,
      language: clone.language || "en",
      isOwner: true,
      previewAvailable: true,
    });
  }
  for (const page of query.data?.pages ?? []) {
    for (const voice of page.library ?? []) {
      if (seen.has(voice.id)) continue;
      seen.add(voice.id);
      voices.push(voice);
    }
  }

  return {
    ...query,
    voices,
    cloned,
    configured: query.data?.pages[0]?.configured ?? false,
  };
}
