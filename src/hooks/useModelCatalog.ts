import { useQuery } from "@tanstack/react-query";
import { proxyUrl } from "@/lib/proxy";

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  prompt_per_mtok: number;
  completion_per_mtok: number;
  context?: number | null;
  description?: string | null;
}

export interface ModelCatalog {
  models: CatalogModel[];
  fetched_at: number;
  source: string;
  ttl_sec: number;
  count: number;
}

/** Fetch the cloud-model pricing catalog from any reachable GPU-exporter
 *  (every host runs the same backend, the catalog is identical).  Falls
 *  through hosts until one responds. */
export function useModelCatalog(hostUrls: string[]) {
  // Stable key from the host list so we refetch only when topology changes.
  const key = hostUrls.join("|");

  return useQuery<ModelCatalog>({
    queryKey: ["model-catalog", key],
    enabled: hostUrls.length > 0,
    staleTime: 6 * 60 * 60 * 1000, // 6h — matches backend cache
    refetchInterval: 30 * 60 * 1000, // 30min sanity refresh
    queryFn: async () => {
      let lastErr: unknown;
      for (const raw of hostUrls) {
        const base = raw.replace(/\/nvidia-smi\.json$/, "");
        try {
          const res = await fetch(proxyUrl(`${base}/api/costs/models`));
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return (await res.json()) as ModelCatalog;
        } catch (e) {
          lastErr = e;
        }
      }
      throw lastErr ?? new Error("no hosts reachable");
    },
  });
}
