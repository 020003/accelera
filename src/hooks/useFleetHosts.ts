import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import { proxyUrl } from "@/lib/proxy";
import type { Host, HostData } from "@/types/dashboard";
import type { NvidiaSmiResponse } from "@/types/gpu";

interface UseFleetHostsOptions {
  demo: boolean;
  refreshInterval: number;
}

interface RuntimeProbeStatus {
  isAvailable?: boolean;
  lastChecked?: number;
  models?: unknown[];
  performanceMetrics?: unknown;
  recentRequests?: unknown[];
  sglangUrl?: string;
  serverInfo?: unknown;
  vllmUrl?: string;
  version?: string;
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
  hosts?: HostData[];
  freshness?: FleetFreshnessSummary;
  fetchDurationMs?: number;
  cacheTtlSeconds?: number;
  runtimeCacheTtlSeconds?: number;
}

interface FleetRuntimeResponse {
  hosts?: HostData[];
}

export function useFleetHosts({ demo, refreshInterval }: UseFleetHostsOptions) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [hostsData, setHostsData] = useState<HostData[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<Record<string, RuntimeProbeStatus>>({});
  const [sglangStatus, setSglangStatus] = useState<Record<string, RuntimeProbeStatus>>({});
  const [vllmStatus, setVllmStatus] = useState<Record<string, RuntimeProbeStatus>>({});
  const queryClient = useQueryClient();

  useEffect(() => {
    fetch("/api/hosts", { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json();
      })
      .then((data: Array<{ url: string; name: string }>) => {
        if (Array.isArray(data)) {
          setHosts(data.map((h) => ({ url: h.url, name: h.name, isConnected: false })));
        }
      })
      .catch(() => {})
      .finally(() => setHostsLoaded(true));
  }, []);

  const { data: demoData, isError: demoError } = useNvidiaSmi({
    apiUrl: null,
    demo,
    refetchIntervalMs: demo ? refreshInterval : 0,
  });

  const checkOllamaAvailability = async (hostUrl: string) => {
    try {
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      const response = await fetch(proxyUrl(`${baseUrl}/api/ollama/discover`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.isAvailable) return result;
      }
      return { isAvailable: false };
    } catch (error) {
      return { isAvailable: false };
    }
  };

  const checkVllmAvailability = async (hostUrl: string) => {
    try {
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      const response = await fetch(proxyUrl(`${baseUrl}/api/vllm/discover`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.isAvailable) return result;
      }
      return { isAvailable: false };
    } catch {
      return { isAvailable: false };
    }
  };

  const checkSglangAvailability = async (hostUrl: string) => {
    try {
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      const response = await fetch(proxyUrl(`${baseUrl}/api/sglang/discover`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.isAvailable) return result;
      }
      return { isAvailable: false };
    } catch {
      return { isAvailable: false };
    }
  };

  const fetchHostData = async (host: Host): Promise<HostData> => {
    try {
      const response = await fetch(proxyUrl(host.url));
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json() as NvidiaSmiResponse;
      const hostData = {
        url: host.url,
        name: host.name,
        isConnected: true,
        gpus: data.gpus || [],
        timestamp: data.timestamp,
        error: undefined,
        ollama: undefined,
      };
      const hostKey = host.url;
      const cachedOllamaStatus = ollamaStatus[hostKey];
      const now = Date.now();
      if (!cachedOllamaStatus || (now - cachedOllamaStatus.lastChecked) > 300000) {
        checkOllamaAvailability(host.url).then(ollamaInfo => {
          const newOllamaStatus = {
            ...ollamaInfo,
            lastChecked: now,
          };
          setOllamaStatus(prev => ({
            ...prev,
            [hostKey]: newOllamaStatus,
          }));
          if (ollamaInfo.isAvailable) {
            setHostsData(prevData =>
              prevData.map(h =>
                h.url === host.url
                  ? {
                      ...h,
                      ollama: {
                        isAvailable: true,
                        models: ollamaInfo.models || [],
                        performanceMetrics: ollamaInfo.performanceMetrics || {
                          tokensPerSecond: 0,
                          modelLoadTimeMs: 0,
                          totalDurationMs: 0,
                          promptProcessingMs: 0,
                          averageLatency: 0,
                          requestCount: 0,
                          errorCount: 0,
                        },
                        recentRequests: ollamaInfo.recentRequests || [],
                      },
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          setOllamaStatus(prev => ({
            ...prev,
            [hostKey]: {
              isAvailable: false,
              lastChecked: now,
            },
          }));
        });
      } else if (cachedOllamaStatus.isAvailable) {
        setHostsData(prevData =>
          prevData.map(h =>
            h.url === host.url
              ? {
                  ...h,
                  ollama: {
                    isAvailable: true,
                    models: cachedOllamaStatus.models || [],
                    performanceMetrics: cachedOllamaStatus.performanceMetrics || {
                      tokensPerSecond: 0,
                      modelLoadTimeMs: 0,
                      totalDurationMs: 0,
                      promptProcessingMs: 0,
                      averageLatency: 0,
                      requestCount: 0,
                      errorCount: 0,
                    },
                    recentRequests: cachedOllamaStatus.recentRequests || [],
                  },
                }
              : h
          )
        );
      }
      const cachedSglangStatus = sglangStatus[hostKey];
      if (!cachedSglangStatus || (now - cachedSglangStatus.lastChecked) > 300000) {
        checkSglangAvailability(host.url).then(sglangInfo => {
          const newSglangStatus = { ...sglangInfo, lastChecked: now };
          setSglangStatus(prev => ({ ...prev, [hostKey]: newSglangStatus }));
          if (sglangInfo.isAvailable) {
            setHostsData(prevData =>
              prevData.map(h =>
                h.url === host.url
                  ? {
                      ...h,
                      sglang: {
                        isAvailable: true,
                        models: sglangInfo.models || [],
                        sglangUrl: sglangInfo.sglangUrl,
                        serverInfo: sglangInfo.serverInfo,
                      },
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          setSglangStatus(prev => ({
            ...prev,
            [hostKey]: { isAvailable: false, lastChecked: now },
          }));
        });
      } else if (cachedSglangStatus.isAvailable) {
        setHostsData(prevData =>
          prevData.map(h =>
            h.url === host.url
              ? {
                  ...h,
                  sglang: {
                    isAvailable: true,
                    models: cachedSglangStatus.models || [],
                    sglangUrl: cachedSglangStatus.sglangUrl,
                    serverInfo: cachedSglangStatus.serverInfo,
                  },
                }
              : h
          )
        );
      }
      const cachedVllmStatus = vllmStatus[hostKey];
      if (!cachedVllmStatus || (now - cachedVllmStatus.lastChecked) > 300000) {
        checkVllmAvailability(host.url).then(vllmInfo => {
          const newVllmStatus = { ...vllmInfo, lastChecked: now };
          setVllmStatus(prev => ({ ...prev, [hostKey]: newVllmStatus }));
          if (vllmInfo.isAvailable) {
            setHostsData(prevData =>
              prevData.map(h =>
                h.url === host.url
                  ? {
                      ...h,
                      vllm: {
                        isAvailable: true,
                        models: vllmInfo.models || [],
                        vllmUrl: vllmInfo.vllmUrl,
                        version: vllmInfo.version,
                      },
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          setVllmStatus(prev => ({
            ...prev,
            [hostKey]: { isAvailable: false, lastChecked: now },
          }));
        });
      } else if (cachedVllmStatus.isAvailable) {
        setHostsData(prevData =>
          prevData.map(h =>
            h.url === host.url
              ? {
                  ...h,
                  vllm: {
                    isAvailable: true,
                    models: cachedVllmStatus.models || [],
                    vllmUrl: cachedVllmStatus.vllmUrl,
                    version: cachedVllmStatus.version,
                  },
                }
              : h
          )
        );
      }
      return hostData;
    } catch (error) {
      return {
        url: host.url,
        name: host.name,
        isConnected: false,
        gpus: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };

  const fetchFleetSnapshot = async (): Promise<FleetSnapshotResponse | null> => {
    try {
      const response = await fetch("/api/fleet/snapshot", { credentials: "include" });
      if (!response.ok) return null;
      const data = await response.json() as FleetSnapshotResponse;
      return Array.isArray(data.hosts) ? data : null;
    } catch {
      return null;
    }
  };

  const fetchFleetRuntime = async (): Promise<FleetRuntimeResponse | null> => {
    try {
      const response = await fetch("/api/fleet/runtime", { credentials: "include" });
      if (!response.ok) return null;
      const data = await response.json() as FleetRuntimeResponse;
      return Array.isArray(data.hosts) ? data : null;
    } catch {
      return null;
    }
  };

  const applyHostSnapshots = (snapshots: HostData[]) => {
    setHostsData(snapshots);
    setHosts((prev) => {
      const liveByUrl = new Map<string, boolean>(
        snapshots.map((host) => [host.url, host.isConnected])
      );
      let mutated = false;
      const next = prev.map((host) => {
        const live = liveByUrl.get(host.url) ?? false;
        if (host.isConnected !== live) {
          mutated = true;
          return { ...host, isConnected: live };
        }
        return host;
      });
      return mutated ? next : prev;
    });
  };

  const fetchSnapshotWithFallback = async (): Promise<FleetSnapshotResponse> => {
    if (demo) {
      const demoParsed = demoData as NvidiaSmiResponse | undefined;
      return { hosts: [{
        url: "demo",
        name: "Demo Host",
        isConnected: !demoError,
        gpus: demoParsed?.gpus || [],
        timestamp: demoParsed?.timestamp,
        error: demoError ? "Demo mode error" : undefined,
      }] };
    }
    const snapshot = await fetchFleetSnapshot();
    if (snapshot?.hosts) return snapshot;
    if (hosts.length === 0) return { hosts: [] };
    return { hosts: await Promise.all(hosts.map(fetchHostData)) };
  };

  const hostsKey = useMemo(
    () => hosts.map((h) => h.url).sort().join(","),
    [hosts]
  );

  const snapshotQuery = useQuery<FleetSnapshotResponse>({
    queryKey: ["fleet-snapshot", hostsKey, demo],
    queryFn: fetchSnapshotWithFallback,
    enabled: demo || hostsKey.length > 0,
    refetchInterval: refreshInterval > 0 ? refreshInterval : false,
    staleTime: Math.max(0, Math.min(refreshInterval / 2, 1000)),
    retry: 1,
  });

  const runtimeQuery = useQuery<FleetRuntimeResponse | null>({
    queryKey: ["fleet-runtime", hostsKey],
    queryFn: fetchFleetRuntime,
    enabled: !demo && hostsKey.length > 0,
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: 1,
  });

  useEffect(() => {
    const snapshotHosts = snapshotQuery.data?.hosts;
    if (!snapshotHosts) return;
    const runtimeHosts = runtimeQuery.data?.hosts || [];
    const runtimeByUrl = new Map(runtimeHosts.map((host) => [host.url, host]));
    applyHostSnapshots(snapshotHosts.map((host) => {
      const runtime = runtimeByUrl.get(host.url);
      if (!runtime) return host;
      return {
        ...host,
        ollama: runtime.ollama || host.ollama,
        sglang: runtime.sglang || host.sglang,
        vllm: runtime.vllm || host.vllm,
      };
    }));
  }, [snapshotQuery.data, runtimeQuery.data]);

  const fetchAllHostsData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["fleet-snapshot"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-runtime"] }),
    ]);
  };

  return {
    hosts,
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
