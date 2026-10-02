import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import type { Host, HostData } from "@/types/dashboard";
import type { NvidiaSmiResponse } from "@/types/gpu";

interface UseFleetHostsOptions {
  demo: boolean;
  refreshInterval: number;
}

interface FleetFreshnessSummary {
  totalHosts: number;
  onlineHosts: number;
  offlineHosts: number;
  liveHosts: number;
  cachedHosts: number;
  staleHosts: number;
  oldestCacheAgeSeconds: number;
  oldestSampleAgeSeconds: number;
}

interface FleetSnapshotResponse {
  hosts: HostData[];
  freshness?: FleetFreshnessSummary;
  fetchDurationMs?: number;
  cacheTtlSeconds?: number;
  runtimeCacheTtlSeconds?: number;
}

interface FleetRuntimeResponse {
  hosts: HostData[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await apiFetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function useFleetHosts({ demo, refreshInterval }: UseFleetHostsOptions) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const queryClient = useQueryClient();
  const { data: demoData, isError: demoError } = useNvidiaSmi({
    apiUrl: null,
    demo,
    refetchIntervalMs: demo ? refreshInterval : 0,
  });

  useEffect(() => {
    let active = true;
    fetchJson<Array<Pick<Host, "url" | "name">>>("/api/hosts")
      .then((configuredHosts) => {
        if (active) setHosts(configuredHosts.map((host) => ({ ...host, isConnected: false })));
      })
      .catch(() => {
        if (active) setHosts([]);
      })
      .finally(() => {
        if (active) setHostsLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const hostsKey = useMemo(() => hosts.map((host) => host.url).sort().join(","), [hosts]);
  const snapshotQuery = useQuery({
    queryKey: ["fleet-snapshot", hostsKey, demo],
    queryFn: async (): Promise<FleetSnapshotResponse> => {
      if (demo) {
        const parsed = demoData as NvidiaSmiResponse | undefined;
        return {
          hosts: [{
            url: "demo",
            name: "Demo Host",
            isConnected: !demoError,
            gpus: parsed?.gpus || [],
            timestamp: parsed?.timestamp,
            error: demoError ? "Demo mode error" : undefined,
          }],
        };
      }
      return fetchJson<FleetSnapshotResponse>("/api/fleet/snapshot");
    },
    enabled: demo || (hostsLoaded && hostsKey.length > 0),
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    staleTime: Math.min(Math.max(refreshInterval / 2, 0), 1_000),
    retry: 1,
  });
  const runtimeQuery = useQuery({
    queryKey: ["fleet-runtime", hostsKey],
    queryFn: () => fetchJson<FleetRuntimeResponse>("/api/fleet/runtime"),
    enabled: !demo && hostsLoaded && hostsKey.length > 0,
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: 1,
  });

  const hostsData = useMemo(() => {
    const snapshots = snapshotQuery.data?.hosts || [];
    const runtimeByUrl = new Map((runtimeQuery.data?.hosts || []).map((host) => [host.url, host]));
    return snapshots.map((host) => {
      const runtime = runtimeByUrl.get(host.url);
      return runtime ? {
        ...host,
        ollama: runtime.ollama || host.ollama,
        sglang: runtime.sglang || host.sglang,
        vllm: runtime.vllm || host.vllm,
      } : host;
    });
  }, [runtimeQuery.data?.hosts, snapshotQuery.data?.hosts]);

  const displayHosts = useMemo(() => {
    const connectionByUrl = new Map(hostsData.map((host) => [host.url, host.isConnected]));
    return hosts.map((host) => ({ ...host, isConnected: connectionByUrl.get(host.url) || false }));
  }, [hosts, hostsData]);

  const fetchAllHostsData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["fleet-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-runtime"] }),
    ]);
  };

  return {
    hosts: displayHosts,
    setHosts,
    hostsLoaded,
    hostsData,
    fleetFreshness: snapshotQuery.data?.freshness,
    fleetFetchDurationMs: snapshotQuery.data?.fetchDurationMs,
    cacheTtlSeconds: snapshotQuery.data?.cacheTtlSeconds,
    runtimeCacheTtlSeconds: snapshotQuery.data?.runtimeCacheTtlSeconds,
    fetchAllHostsData,
  };
}
