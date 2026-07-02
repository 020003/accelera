import { useEffect, useMemo, useRef, useState } from "react";
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

export function useFleetHosts({ demo, refreshInterval }: UseFleetHostsOptions) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [hostsData, setHostsData] = useState<HostData[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<Record<string, RuntimeProbeStatus>>({});
  const [sglangStatus, setSglangStatus] = useState<Record<string, RuntimeProbeStatus>>({});
  const [vllmStatus, setVllmStatus] = useState<Record<string, RuntimeProbeStatus>>({});

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

  const fetchInProgress = useRef(false);

  const fetchAllHostsData = async () => {
    if (fetchInProgress.current) return;
    fetchInProgress.current = true;
    try {
      if (demo) {
        const demoParsed = demoData as NvidiaSmiResponse | undefined;
        setHostsData([{
          url: "demo",
          name: "Demo Host",
          isConnected: !demoError,
          gpus: demoParsed?.gpus || [],
          timestamp: demoParsed?.timestamp,
          error: demoError ? "Demo mode error" : undefined,
        }]);
        return;
      }
      if (hosts.length === 0) {
        setHostsData([]);
        return;
      }
      const results = await Promise.all(hosts.map(fetchHostData));
      setHostsData(prevData => {
        const newData = [...prevData];
        let hasChanges = false;
        results.forEach((newHostData) => {
          const existingIndex = newData.findIndex(h => h.url === newHostData.url);
          if (existingIndex >= 0) {
            const existing = newData[existingIndex];
            const gpusChanged = existing.gpus.length !== newHostData.gpus.length ||
              existing.gpus.some((gpu, i) => {
                const newGpu = newHostData.gpus[i];
                return !newGpu ||
                  gpu.utilization !== newGpu.utilization ||
                  gpu.temperature !== newGpu.temperature ||
                  gpu.power.draw !== newGpu.power.draw ||
                  gpu.memory.used !== newGpu.memory.used;
              });
            if (
              existing.isConnected !== newHostData.isConnected ||
              existing.error !== newHostData.error ||
              existing.timestamp !== newHostData.timestamp ||
              gpusChanged ||
              (!existing.ollama && newHostData.ollama)
            ) {
              newData[existingIndex] = {
                ...existing,
                ...newHostData,
                ollama: newHostData.ollama || existing.ollama,
                sglang: newHostData.sglang || existing.sglang,
                vllm: newHostData.vllm || existing.vllm,
              };
              hasChanges = true;
            }
          } else {
            newData.push(newHostData);
            hasChanges = true;
          }
        });
        const filteredData = newData.filter(hostData =>
          results.some(r => r.url === hostData.url)
        );
        if (filteredData.length !== newData.length) {
          hasChanges = true;
        }
        const orderIndex = new Map<string, number>(results.map((r, i) => [r.url, i]));
        const sorted = [...filteredData].sort(
          (a, b) => (orderIndex.get(a.url) ?? 0) - (orderIndex.get(b.url) ?? 0)
        );
        const orderChanged = sorted.some((h, i) => h.url !== filteredData[i]?.url);
        if (orderChanged) hasChanges = true;
        return hasChanges ? sorted : prevData;
      });
      setHosts((prev) => {
        const liveByUrl = new Map<string, boolean>(
          results.map((r) => [r.url, r.isConnected])
        );
        let mutated = false;
        const next = prev.map((h) => {
          const live = liveByUrl.get(h.url) ?? false;
          if (h.isConnected !== live) {
            mutated = true;
            return { ...h, isConnected: live };
          }
          return h;
        });
        return mutated ? next : prev;
      });
    } finally {
      fetchInProgress.current = false;
    }
  };

  const hostsKey = useMemo(
    () => hosts.map((h) => h.url).sort().join(","),
    [hosts]
  );

  const fetchRef = useRef(fetchAllHostsData);
  fetchRef.current = fetchAllHostsData;

  useEffect(() => {
    if (demo || hostsKey.length > 0) {
      fetchRef.current();
      if (refreshInterval > 0) {
        const interval = setInterval(() => fetchRef.current(), refreshInterval);
        return () => clearInterval(interval);
      }
    }
  }, [hostsKey, demo, refreshInterval]);

  return {
    hosts,
    setHosts,
    hostsLoaded,
    hostsData,
    fetchAllHostsData,
  };
}
