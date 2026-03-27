import { useQuery } from "@tanstack/react-query";
import { createMockNvidiaData } from "@/data/mockNvidia";
import type { NvidiaSmiResponse } from "@/types/gpu";
import { proxyUrl } from "@/lib/proxy";

export interface UseNvidiaSmiOptions {
  apiUrl?: string | null;
  demo?: boolean;
  refetchIntervalMs?: number;
}

export function useNvidiaSmi({ apiUrl, demo = false, refetchIntervalMs = 5000 }: UseNvidiaSmiOptions) {
  return useQuery<NvidiaSmiResponse>({
    queryKey: ["nvidia-smi", apiUrl, demo],
    queryFn: async () => {
      if (demo || !apiUrl) {
        return createMockNvidiaData();
      }
      const res = await fetch(proxyUrl(apiUrl));
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      return (await res.json()) as NvidiaSmiResponse;
    },
    refetchInterval: refetchIntervalMs && refetchIntervalMs > 0 ? refetchIntervalMs : false,
  });
}
