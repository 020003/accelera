import { useQuery } from "@tanstack/react-query";

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

/** Fetch the cloud-model pricing catalog from the central backend.
 *  Same-origin call (no /api-proxy/ fan-out): one fetch for the whole
 *  fleet, served from the central cache. */
export function useModelCatalog(enabled: boolean = true) {
  return useQuery<ModelCatalog>({
    queryKey: ["model-catalog"],
    enabled,
    staleTime: 6 * 60 * 60 * 1000, // 6h — matches backend cache TTL
    refetchInterval: 30 * 60 * 1000, // 30min sanity refresh
    queryFn: async () => {
      const res = await fetch("/api/costs/models", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as ModelCatalog;
    },
  });
}
