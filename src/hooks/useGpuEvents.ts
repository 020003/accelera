import { useQuery } from "@tanstack/react-query";
import type { GpuEventsResponse } from "@/types/events";
import { proxyUrl } from "@/lib/proxy";

export function useGpuEvents(hostUrl?: string, enabled = true) {
  return useQuery<GpuEventsResponse>({
    queryKey: ["gpu-events", hostUrl],
    queryFn: async () => {
      const base = hostUrl ? hostUrl.replace(/\/nvidia-smi\.json$/, "") : "";
      const res = await fetch(proxyUrl(`${base}/api/gpu/events`));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    enabled,
    refetchInterval: 15_000,
  });
}
