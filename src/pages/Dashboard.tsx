import { useState, useEffect, useMemo, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import { useTopology } from "@/hooks/useTopology";
import { MultiHostOverview } from "@/components/MultiHostOverview";
import { HostTab } from "@/components/HostTab";
import { PowerUsageChart } from "@/components/PowerUsageChart";
import { AlertsManager } from "@/components/AlertsManager";
import { GpuEventsPanel } from "@/components/GpuEventsPanel";
import { DashboardHeader } from "@/components/DashboardHeader";
import { DashboardFooter } from "@/components/DashboardFooter";
import { VisualizationsTab } from "@/components/VisualizationsTab";
import { SettingsTab } from "@/components/SettingsTab";
import { useCurrency } from "@/hooks/useCurrency";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Monitor, BarChart3, Cog, TrendingUp, Bell, ShieldAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { NvidiaSmiResponse } from "@/types/gpu";
import type { Host, HostData } from "@/types/dashboard";
import { proxyUrl } from "@/lib/proxy";
import { useTheme } from "@/hooks/useTheme";


export default function Dashboard() {
  // Load settings from localStorage
  const [demo, setDemo] = useState<boolean>(() => 
    localStorage.getItem("gpu_monitor_demo") === "true"
  );
  const [refreshInterval, setRefreshInterval] = useState<number>(() => 
    parseInt(localStorage.getItem("gpu_monitor_refresh_interval") || "5000")
  );
  const [energyRate, setEnergyRate] = useState<number>(() => 
    parseFloat(localStorage.getItem("gpu_monitor_energy_rate") || "0")
  );
  const { currency, setCurrency } = useCurrency();
  const { theme, toggle: toggleTheme } = useTheme();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [hostsData, setHostsData] = useState<HostData[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const { data: topologyData } = useTopology();
  const [heatmapData, setHeatmapData] = useState(null);
  const [advancedDataLoaded, setAdvancedDataLoaded] = useState(false);
  const [heatmapHours, setHeatmapHours] = useState(6);
  const [vizRefreshing, setVizRefreshing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<Record<string, any>>({});
  const [sglangStatus, setSglangStatus] = useState<Record<string, any>>({});
  const [vllmStatus, setVllmStatus] = useState<Record<string, any>>({});

  // Load hosts from central backend on mount
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
  
  // Create a Map for the PowerUsageChart
  const hostDataMap = new Map(
    hostsData.map(host => [host.url, { gpus: host.gpus, timestamp: host.timestamp }])
  );
  

  // Demo mode API query
  const { data: demoData, isError: demoError, isFetching: demoFetching } = useNvidiaSmi({
    apiUrl: null,
    demo: demo,
    refetchIntervalMs: demo ? refreshInterval : 0
  });


  // Helper function to fetch advanced visualization data from GPU hosts (lazy-loaded)
  const fetchAdvancedVisualizationData = async () => {
    if (hosts.length === 0 || advancedDataLoaded) return;

    try {
      // Create timeout signal for faster failure
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), 5000); // 5 second timeout

      // Fetch all data types from all hosts in parallel with timeout
      const hostPromises = hosts.map(async (host) => {
        try {
          const url = new URL(host.url);
          const baseUrl = `${url.protocol}//${url.host}`;
          
          // Fetch heatmap API for this host
          const heatmapResponse = await fetch(
            proxyUrl(`${baseUrl}/api/heatmap?metric=utilization&hours=2`),
            { signal: timeoutController.signal }
          ).catch(() => null);

          const results: { host: string; heatmap: any } = { host: host.name, heatmap: null };

          if (heatmapResponse?.ok) {
            results.heatmap = await heatmapResponse.json();
          }

          return results;
        } catch (error) {
          console.error(`Error fetching data from ${host.name}:`, error);
          return { host: host.name, heatmap: null };
        }
      });

      const hostResults = await Promise.all(hostPromises);
      clearTimeout(timeoutId);

      // Process heatmap data
      const validHeatmapResults = hostResults.filter(result => result.heatmap && result.heatmap.hosts);
      if (validHeatmapResults.length > 0) {
        const combinedHeatmap = {
          hosts: validHeatmapResults.flatMap(result => result.heatmap.hosts),
          timestamps: validHeatmapResults[0].heatmap.timestamps,
          metrics: {
            utilization: validHeatmapResults.flatMap(result => result.heatmap.metrics?.utilization || []),
            temperature: validHeatmapResults.flatMap(result => result.heatmap.metrics?.temperature || []),
            power: validHeatmapResults.flatMap(result => result.heatmap.metrics?.power || []),
            memory: validHeatmapResults.flatMap(result => result.heatmap.metrics?.memory || [])
          }
        };
        setHeatmapData(combinedHeatmap);
      }

      setAdvancedDataLoaded(true);

    } catch (error) {
      console.error('Error fetching advanced visualization data:', error);
    }
  };

  // Helper function to check if Ollama is available on a host
  const checkOllamaAvailability = async (hostUrl: string) => {
    try {
      // Extract the base URL from the host URL (remove the /nvidia-smi.json path)
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      
      // Call the Ollama discovery endpoint directly on the GPU host
      const response = await fetch(proxyUrl(`${baseUrl}/api/ollama/discover`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000) // 3 second timeout for faster initial load
      });
      
      if (response.ok) {
        const result = await response.json();
        
        if (result.isAvailable) {
          return result;
        }
      }
      
      return { isAvailable: false };
    } catch (error) {
      return { isAvailable: false };
    }
  };

  // Helper function to check if vLLM is available on a host
  const checkVllmAvailability = async (hostUrl: string) => {
    try {
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      
      const response = await fetch(proxyUrl(`${baseUrl}/api/vllm/discover`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000)
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

  // Helper function to check if SGLang is available on a host
  const checkSglangAvailability = async (hostUrl: string) => {
    try {
      const url = new URL(hostUrl);
      const baseUrl = `${url.protocol}//${url.host}`;
      
      const response = await fetch(proxyUrl(`${baseUrl}/api/sglang/discover`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostUrl: baseUrl }),
        signal: AbortSignal.timeout(3000)
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

  // Helper function to fetch data from a host
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
        ollama: undefined
      };

      // Check for Ollama availability (with caching to avoid flickering)
      const hostKey = host.url;
      const cachedOllamaStatus = ollamaStatus[hostKey];
      const now = Date.now();
      
      // Only check Ollama if we don't have cached data or it's older than 5 minutes
      if (!cachedOllamaStatus || (now - cachedOllamaStatus.lastChecked) > 300000) {
        checkOllamaAvailability(host.url).then(ollamaInfo => {
          const newOllamaStatus = {
            ...ollamaInfo,
            lastChecked: now
          };
          
          // Cache the result
          setOllamaStatus(prev => ({
            ...prev,
            [hostKey]: newOllamaStatus
          }));
          
          if (ollamaInfo.isAvailable) {
            // Update the host data with Ollama info when available
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
                          errorCount: 0
                        },
                        recentRequests: ollamaInfo.recentRequests || []
                      }
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          // Cache the failure too
          setOllamaStatus(prev => ({
            ...prev,
            [hostKey]: {
              isAvailable: false,
              lastChecked: now
            }
          }));
        });
      } else if (cachedOllamaStatus.isAvailable) {
        // Use cached Ollama data
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
                      errorCount: 0
                    },
                    recentRequests: cachedOllamaStatus.recentRequests || []
                  }
                }
              : h
          )
        );
      }
      
      // Check for SGLang availability (same caching pattern as Ollama)
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
                      }
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          setSglangStatus(prev => ({
            ...prev,
            [hostKey]: { isAvailable: false, lastChecked: now }
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
                  }
                }
              : h
          )
        );
      }

      // Check for vLLM availability (same caching pattern)
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
                      }
                    }
                  : h
              )
            );
          }
        }).catch(() => {
          setVllmStatus(prev => ({
            ...prev,
            [hostKey]: { isAvailable: false, lastChecked: now }
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
                  }
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
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  };

  // Fetch data from all hosts
  const fetchAllHostsData = async () => {
    if (demo) {
      // Demo mode - use demo data for overview
      const demoParsed = demoData as NvidiaSmiResponse | undefined;
      setHostsData([{
        url: "demo",
        name: "Demo Host",
        isConnected: !demoError,
        gpus: demoParsed?.gpus || [],
        timestamp: demoParsed?.timestamp,
        error: demoError ? "Demo mode error" : undefined
      }]);
      return;
    }

    if (hosts.length === 0) {
      setHostsData([]);
      return;
    }

    const results = await Promise.all(hosts.map(fetchHostData));
    
    // Smart update - only update if data actually changed
    setHostsData(prevData => {
      const newData = [...prevData];
      let hasChanges = false;
      
      results.forEach((newHostData) => {
        const existingIndex = newData.findIndex(h => h.url === newHostData.url);
        
        if (existingIndex >= 0) {
          const existing = newData[existingIndex];
          
          // Only update if there are meaningful changes
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
            (!existing.ollama && newHostData.ollama) // Only add ollama if it wasn't there before
          ) {
            newData[existingIndex] = {
              ...existing,
              ...newHostData,
              // Preserve ollama/sglang/vllm data if it exists and new data doesn't have it
              ollama: newHostData.ollama || existing.ollama,
              sglang: newHostData.sglang || existing.sglang,
              vllm: newHostData.vllm || existing.vllm
            };
            hasChanges = true;
          }
        } else {
          // New host
          newData.push(newHostData);
          hasChanges = true;
        }
      });
      
      // Remove hosts that no longer exist
      const filteredData = newData.filter(hostData => 
        results.some(r => r.url === hostData.url)
      );
      
      if (filteredData.length !== newData.length) {
        hasChanges = true;
      }
      
      return hasChanges ? filteredData : prevData;
    });
    
    // Don't fetch advanced visualization data on initial load - load lazily when tab is accessed
    
    // Update host connection status without overwriting hosts state
    // This prevents the glitch where newly added hosts disappear
    const updatedHosts = hosts.map(host => {
      const result = results.find(r => r.url === host.url);
      return { ...host, isConnected: result?.isConnected || false };
    });
    
    // Only update hosts if the connection status actually changed
    const hasChanges = updatedHosts.some((updatedHost, index) => 
      hosts[index].isConnected !== updatedHost.isConnected
    );
    
    if (hasChanges) {
      setHosts(updatedHosts);
    }
  };

  // Stable key: only changes when the set of host URLs changes, NOT on
  // isConnected flips. This prevents the infinite re-fetch loop where
  // connection-status changes re-trigger the effect immediately.
  const hostsKey = useMemo(
    () => hosts.map((h) => h.url).sort().join(","),
    [hosts]
  );

  // Keep a ref to the latest hosts so the interval callback always
  // sees the current list without being a dependency itself.
  const hostsRef = useRef(hosts);
  hostsRef.current = hosts;

  // Auto-refresh data
  useEffect(() => {
    if (demo || hostsKey.length > 0) {
      fetchAllHostsData();
      
      if (refreshInterval > 0) {
        const interval = setInterval(fetchAllHostsData, refreshInterval);
        return () => clearInterval(interval);
      }
    }
  }, [hostsKey, demo, refreshInterval, demoData]);

  // Lazy load advanced visualization data when needed
  useEffect(() => {
    if (activeTab === "visualizations" && !advancedDataLoaded && hosts.length > 0) {
      fetchAdvancedVisualizationData();
    }
  }, [activeTab, advancedDataLoaded, hosts.length]);


  const handleRefreshInterval = (value: string) => {
    const interval = parseInt(value);
    setRefreshInterval(interval);
    localStorage.setItem("gpu_monitor_refresh_interval", interval.toString());
  };

  const handleEnergyRate = (value: string) => {
    const rate = parseFloat(value) || 0;
    setEnergyRate(rate);
    localStorage.setItem("gpu_monitor_energy_rate", rate.toString());
  };

  const handleDemoToggle = (enabled: boolean) => {
    setDemo(enabled);
    localStorage.setItem("gpu_monitor_demo", enabled.toString());
    if (enabled) {
      setHosts([]);
      toast.info("Demo mode enabled");
    } else {
      toast.info("Demo mode disabled");
    }
  };

  const connectedHosts = hostsData.filter(h => h.isConnected);
  const totalGpus = connectedHosts.reduce((sum, host) => sum + host.gpus.length, 0);
  const totalOllamaModels = hostsData.reduce((sum, host) => sum + (host.ollama?.models.length || 0), 0);
  const totalSglangModels = hostsData.reduce((sum, host) => sum + (host.sglang?.models.length || 0), 0);
  const totalVllmModels = hostsData.reduce((sum, host) => sum + (host.vllm?.models.length || 0), 0);
  const totalAiModels = totalOllamaModels + totalSglangModels + totalVllmModels;
  const hostsWithOllama = hostsData.filter(h => h.ollama?.isAvailable).length;
  const hostsWithSglang = hostsData.filter(h => h.sglang?.isAvailable).length;
  const hostsWithVllm = hostsData.filter(h => h.vllm?.isAvailable).length;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Accelera - High-Performance GPU Acceleration Platform</title>
        <meta name="description" content="Professional GPU acceleration platform for NVIDIA graphics cards with advanced AI workload management, real-time monitoring, and performance optimization." />
      </Helmet>

      <DashboardHeader
        theme={theme}
        toggleTheme={toggleTheme}
        connectedHosts={connectedHosts}
        hostsData={hostsData}
        totalGpus={totalGpus}
        totalAiModels={totalAiModels}
        hostsWithOllama={hostsWithOllama}
        hostsWithSglang={hostsWithSglang}
      />

      <main className="container mx-auto px-4 py-6 space-y-6">

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex w-full overflow-x-auto">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="visualizations" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Advanced Visualizations
            </TabsTrigger>
            {hostsData.map((host) => (
              <TabsTrigger key={host.url} value={host.url} className="flex items-center gap-1.5">
                <Monitor className="h-4 w-4" />
                {host.name}
                {host.isConnected && (
                  <div className="w-2 h-2 bg-accelera-green rounded-full" />
                )}
                {host.ollama?.isAvailable && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 font-medium leading-none">O</span>
                )}
                {host.sglang?.isAvailable && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium leading-none">S</span>
                )}
                {host.vllm?.isAvailable && (
                  <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400 font-medium leading-none">V</span>
                )}
              </TabsTrigger>
            ))}
            <TabsTrigger value="alerts" className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="gpu-events" className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              GPU Health
            </TabsTrigger>
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <Cog className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {hostsData.length === 0 && !demo ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="p-4 bg-muted/50 rounded-full mb-4">
                    <Monitor className="h-10 w-10 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-1">No GPU hosts connected</h3>
                  <p className="text-sm text-muted-foreground max-w-md mb-4">
                    Add a GPU exporter endpoint in the <strong>Settings</strong> tab to start monitoring.
                    <br />
                    <span className="text-xs">Example: <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">http://gpu-host:5000/nvidia-smi.json</code></span>
                  </p>
                  <Button variant="outline" size="sm" className="gap-2" onClick={() => setActiveTab("settings")}>
                    <Cog className="h-4 w-4" />
                    Open Settings
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <MultiHostOverview hostsData={hostsData} energyRate={energyRate} currencySymbol={currency.symbol} />
                <PowerUsageChart 
                  hosts={hosts} 
                  hostData={hostDataMap} 
                  refreshInterval={refreshInterval}
                  energyRate={energyRate}
                  currencySymbol={currency.symbol}
                />
              </>
            )}
          </TabsContent>

          {/* Advanced Visualizations Tab */}
          <TabsContent value="visualizations" className="space-y-4">
            <VisualizationsTab
              topologyData={topologyData}
              heatmapData={heatmapData}
              heatmapHours={heatmapHours}
              setHeatmapHours={setHeatmapHours}
              advancedDataLoaded={advancedDataLoaded}
              setAdvancedDataLoaded={setAdvancedDataLoaded}
              fetchAdvancedVisualizationData={fetchAdvancedVisualizationData}
              vizRefreshing={vizRefreshing}
              setVizRefreshing={setVizRefreshing}
            />
          </TabsContent>

          {/* Individual Host Tabs */}
          {hostsData.map((host) => (
            <TabsContent key={host.url} value={host.url}>
              <HostTab
                hostName={host.name}
                hostUrl={host.url}
                gpus={host.gpus}
                isConnected={host.isConnected}
                isFetching={false}
                error={host.error}
                timestamp={host.timestamp}
                energyRate={energyRate}
                currencySymbol={currency.symbol}
                onRefresh={fetchAllHostsData}
                ollama={host.ollama}
                sglang={host.sglang}
                vllm={host.vllm}
              />
            </TabsContent>
          ))}

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="space-y-6">
            <AlertsManager />
          </TabsContent>

          {/* GPU Health Events Tab */}
          <TabsContent value="gpu-events" className="space-y-6">
            {hostsData.length > 0 ? (
              hostsData.map((host) => (
                <div key={host.url} className="space-y-2">
                  <h3 className="text-sm font-medium text-muted-foreground">{host.name} ({host.url})</h3>
                  <GpuEventsPanel hostUrl={host.url} />
                </div>
              ))
            ) : (
              <GpuEventsPanel />
            )}
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <SettingsTab
              refreshInterval={refreshInterval}
              handleRefreshInterval={handleRefreshInterval}
              energyRate={energyRate}
              handleEnergyRate={handleEnergyRate}
              demo={demo}
              handleDemoToggle={handleDemoToggle}
              currency={currency}
              setCurrency={setCurrency}
              hosts={hosts}
              setHosts={setHosts}
              hostsData={hostsData}
              fetchAllHostsData={fetchAllHostsData}
            />
          </TabsContent>
        </Tabs>
      </main>

      <DashboardFooter
        totalGpus={totalGpus}
        connectedHosts={connectedHosts}
        totalAiModels={totalAiModels}
      />
    </div>
  );
}
