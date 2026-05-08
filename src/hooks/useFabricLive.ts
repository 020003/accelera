import { useQueries } from "@tanstack/react-query";
import { proxyUrl } from "@/lib/proxy";

export interface IBPort {
  device: string;
  port: number;
  state: string;
  rate_gbps: number;
  link_layer: string;
  tx_bytes: number;
  rx_bytes: number;
  tx_bps: number;
  rx_bps: number;
  errors: { link_downed: number; symbol_errors: number };
}

export interface NVLink {
  gpu: number;
  link: number;
  state: string;
  tx_bps: number;
  rx_bps: number;
  tx_bytes?: number;
  rx_bytes?: number;
}

export interface FabricSnapshot {
  host: string;        // container hostname (rough)
  hostUrl: string;     // GPU exporter base URL
  timestamp: number;
  nvlink: NVLink[];
  infiniband: IBPort[];
}

export interface FabricResult {
  data?: FabricSnapshot;
  isError: boolean;
  hostUrl: string;
}

/** Fan out across every GPU exporter and return live fabric data per host. */
export function useFabricLive(hostUrls: string[], refreshIntervalMs = 3000) {
  const queries = useQueries({
    queries: hostUrls.map((hostUrl) => {
      const baseUrl = hostUrl.replace(/\/nvidia-smi\.json$/, "");
      return {
        queryKey: ["fabric-live", baseUrl],
        queryFn: async (): Promise<FabricSnapshot> => {
          const res = await fetch(proxyUrl(`${baseUrl}/api/fabric/live`));
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const json = await res.json();
          return { ...json, hostUrl };
        },
        enabled: !!baseUrl,
        refetchInterval: refreshIntervalMs,
        retry: 0,
        staleTime: refreshIntervalMs / 2,
      };
    }),
  });

  return queries.map<FabricResult>((q, i) => ({
    data: q.data,
    isError: q.isError,
    hostUrl: hostUrls[i],
  }));
}
