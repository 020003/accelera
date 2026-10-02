import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

export interface IBPort {
  device: string;
  port: number;
  state: string;
  physical_state: string;
  rate_gbps: number;
  link_layer: string;
  lid: string;
  sm_lid: string;
  gids: string[];
  pkeys: string[];
  netdev?: string;
  tx_bytes: number;
  rx_bytes: number;
  tx_bps: number;
  rx_bps: number;
  rdma_tx_bps: number | null;
  rdma_rx_bps: number | null;
  rdma_available: boolean;
  counter_source: string;
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
  host: string;
  hostUrl: string;
  timestamp: number;
  nvlink: NVLink[];
  infiniband: IBPort[];
}

interface FleetFabricHost extends Partial<FabricSnapshot> {
  url: string;
  name: string;
  fetchedAt: number;
  fetchDurationMs: number;
  isConnected: boolean;
  error?: string;
}

interface FleetFabricResponse {
  fetchedAt: number;
  fetchDurationMs: number;
  cacheTtlSeconds: number;
  hosts: FleetFabricHost[];
}

export interface FabricResult {
  data?: FabricSnapshot;
  isError: boolean;
  hostUrl: string;
  name?: string;
  error?: string;
}

export function useFabricLive(hosts: Array<{ url?: string; name?: string }>, refreshIntervalMs = 3000) {
  const query = useQuery({
    queryKey: ["fleet-fabric"],
    queryFn: async (): Promise<FleetFabricResponse> => {
      const response = await apiFetch("/api/fleet/fabric");
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json() as Promise<FleetFabricResponse>;
    },
    refetchInterval: refreshIntervalMs,
    staleTime: refreshIntervalMs / 2,
    retry: 1,
  });
  const byUrl = new Map((query.data?.hosts || []).map((host) => [host.url, host]));

  return hosts.filter((host): host is { url: string; name?: string } => Boolean(host.url)).map<FabricResult>((host) => {
    const payload = byUrl.get(host.url);
    if (!payload) return { hostUrl: host.url, name: host.name, isError: query.isError, error: query.error?.message };
    if (!payload.isConnected) return { hostUrl: host.url, name: payload.name, isError: true, error: payload.error };
    return {
      hostUrl: host.url,
      name: payload.name,
      isError: false,
      data: {
        host: payload.host || payload.name,
        hostUrl: host.url,
        timestamp: payload.timestamp || payload.fetchedAt,
        nvlink: payload.nvlink || [],
        infiniband: payload.infiniband || [],
      },
    };
  });
}
