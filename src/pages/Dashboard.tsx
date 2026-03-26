import { useState, useEffect, lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import { useTopology } from "@/hooks/useTopology";
import { HostManager } from "@/components/HostManager";
import { MultiHostOverview } from "@/components/MultiHostOverview";
import { HostTab } from "@/components/HostTab";
import { PowerUsageChart } from "@/components/PowerUsageChart";
import { AlertsManager } from "@/components/AlertsManager";
import { GpuEventsPanel } from "@/components/GpuEventsPanel";
import { SystemStatus } from "@/components/SystemStatus";
import { ConfigPanel } from "@/components/ConfigPanel";
import { useAuth } from "@/hooks/useAuth";

// Lazy load heavy visualization components
const GPUTopologyMap = lazy(() => import("@/components/GPUTopologyMap").then(m => ({ default: m.GPUTopologyMap })));
const GPU3DHeatmap = lazy(() => import("@/components/GPU3DHeatmap").then(m => ({ default: m.GPU3DHeatmap })));
const AIWorkloadTimeline = lazy(() => import("@/components/AIWorkloadTimeline").then(m => ({ default: m.AIWorkloadTimeline })));
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Monitor, BarChart3, Settings, Cog, TrendingUp, NetworkIcon, Clock, Bell, ShieldAlert, Lock, LogOut, Activity, Thermometer, Zap, HardDrive, Layers, Brain, Cpu, Cable, Loader2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { NvidiaSmiResponse, GpuInfo } from "@/types/gpu";

interface Host {
  url: string;
  name: string;
  isConnected: boolean;
}

interface HostData {
  url: string;
  name: string;
  isConnected: boolean;
  gpus: GpuInfo[];
  timestamp?: string;
  error?: string;
  ollama?: {
    isAvailable: boolean;
    models: any[];
    performanceMetrics: any;
    recentRequests: any[];
  };
}

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
  const [hosts, setHosts] = useState<Host[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gpu_monitor_hosts") || "[]");
    } catch {
      return [];
    }
  });
  const [hostsData, setHostsData] = useState<HostData[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const { data: topologyData } = useTopology();
  const [heatmapData, setHeatmapData] = useState(null);
  const [timelineData, setTimelineData] = useState(null);
  const [advancedDataLoaded, setAdvancedDataLoaded] = useState(false);
  const [heatmapHours, setHeatmapHours] = useState(6);
  const [vizRefreshing, setVizRefreshing] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<Record<string, any>>({});
  
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
          
          // Fetch heatmap and timeline APIs for this host in parallel
          const [heatmapResponse, timelineResponse] = await Promise.allSettled([
            fetch(`${baseUrl}/api/heatmap?metric=utilization&hours=2`, { signal: timeoutController.signal }), // Reduced hours for faster loading
            fetch(`${baseUrl}/api/timeline`, { signal: timeoutController.signal })
          ]);

          const results = { host: host.name, heatmap: null, timeline: null };

          if (heatmapResponse.status === 'fulfilled' && heatmapResponse.value.ok) {
            results.heatmap = await heatmapResponse.value.json();
          }
          if (timelineResponse.status === 'fulfilled' && timelineResponse.value.ok) {
            results.timeline = await timelineResponse.value.json();
          }

          return results;
        } catch (error) {
          console.error(`Error fetching data from ${host.name}:`, error);
          return { host: host.name, heatmap: null, timeline: null };
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

      // Process timeline data
      const validTimelineResults = hostResults.filter(result => result.timeline && result.timeline.events);
      
      if (validTimelineResults.length > 0) {
        // Ensure unique event IDs by prefixing with host index
        const allEvents = validTimelineResults.flatMap((result, hostIndex) => 
          result.timeline.events.map((event: any) => ({
            ...event,
            id: `host${hostIndex}-${event.id}` // Make IDs unique across hosts
          }))
        );
        
        const combinedTimeline = {
          events: allEvents,
          hosts: [...new Set(validTimelineResults.flatMap(result => result.timeline.events.map((event: any) => event.host)))]
        };
        setTimelineData(combinedTimeline);
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
      const response = await fetch(`${baseUrl}/api/ollama/discover`, {
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

  // Helper function to fetch data from a host
  const fetchHostData = async (host: Host): Promise<HostData> => {
    try {
      const response = await fetch(host.url);
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
              // Preserve ollama data if it exists and new data doesn't have it
              ollama: newHostData.ollama || existing.ollama
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
      // Also update localStorage to persist connection status
      localStorage.setItem("gpu_monitor_hosts", JSON.stringify(updatedHosts));
    }
  };

  // Auto-refresh data
  useEffect(() => {
    if (demo || hosts.length > 0) {
      fetchAllHostsData();
      
      if (refreshInterval > 0) {
        const interval = setInterval(fetchAllHostsData, refreshInterval);
        return () => clearInterval(interval);
      }
    }
  }, [hosts, demo, refreshInterval, demoData]);

  // Lazy load advanced visualization data when needed
  useEffect(() => {
    if (activeTab === "visualizations" && !advancedDataLoaded && hosts.length > 0) {
      fetchAdvancedVisualizationData();
    }
  }, [activeTab, advancedDataLoaded, hosts.length]);

  // The timeline is nested under visualizations tab, so we fetch it when visualizations is accessed
  // The existing fetchAdvancedVisualizationData already handles timeline data

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
      localStorage.setItem("gpu_monitor_hosts", "[]");
      toast.info("Demo mode enabled");
    } else {
      toast.info("Demo mode disabled");
    }
  };

  const connectedHosts = hostsData.filter(h => h.isConnected);
  const totalGpus = connectedHosts.reduce((sum, host) => sum + host.gpus.length, 0);
  const totalOllamaModels = hostsData.reduce((sum, host) => sum + (host.ollama?.models.length || 0), 0);
  const hostsWithOllama = hostsData.filter(h => h.ollama?.isAvailable).length;

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Accelera - High-Performance GPU Acceleration Platform</title>
        <meta name="description" content="Professional GPU acceleration platform for NVIDIA graphics cards with advanced AI workload management, real-time monitoring, and performance optimization." />
      </Helmet>

      {/* Header */}
      <header className="navbar">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img 
                src="/logo.png" 
                alt="Accelera" 
                className="h-12 w-auto"
              />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Accelera</h1>
                <p className="text-sm text-muted-foreground">
                  High-Performance GPU Acceleration Platform
                </p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">GPU Hosts:</span> {connectedHosts.length}/{hostsData.length}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">GPUs:</span> {totalGpus}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Ollama:</span> {hostsWithOllama}/{hostsData.length}
              </div>
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">AI Models:</span> {totalOllamaModels}
              </div>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
                (connectedHosts.length > 0 || hostsWithOllama > 0)
                  ? "bg-accelera-green/10 text-accelera-green" 
                  : "bg-red-500/10 text-red-500"
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  (connectedHosts.length > 0 || hostsWithOllama > 0) ? "bg-accelera-green animate-pulse-slow" : "bg-red-500"
                }`} />
                {(connectedHosts.length > 0 || hostsWithOllama > 0) ? "Online" : "Offline"}
              </div>
              
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="visualizations" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Advanced Visualizations
            </TabsTrigger>
            {hostsData.map((host) => (
              <TabsTrigger key={host.url} value={host.url} className="flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                {host.name}
                {host.isConnected && (
                  <div className="w-2 h-2 bg-accelera-green rounded-full" />
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
            <MultiHostOverview hostsData={hostsData} energyRate={energyRate} />
            <PowerUsageChart 
              hosts={hosts} 
              hostData={hostDataMap} 
              refreshInterval={refreshInterval}
              energyRate={energyRate}
            />
          </TabsContent>

          {/* Advanced Visualizations Tab */}
          <TabsContent value="visualizations" className="space-y-4">
            <Tabs defaultValue="topology" className="space-y-4">
              {/* Tab header row */}
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="topology" className="gap-1.5 text-xs">
                    <NetworkIcon className="h-3.5 w-3.5" />
                    GPU Topology
                  </TabsTrigger>
                  <TabsTrigger value="heatmap" className="gap-1.5 text-xs">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Cluster Heatmap
                  </TabsTrigger>
                  <TabsTrigger value="timeline" className="gap-1.5 text-xs">
                    <Clock className="h-3.5 w-3.5" />
                    Workload Timeline
                  </TabsTrigger>
                </TabsList>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  disabled={vizRefreshing}
                  onClick={async () => {
                    setVizRefreshing(true);
                    setAdvancedDataLoaded(false);
                    await fetchAdvancedVisualizationData();
                    setVizRefreshing(false);
                  }}
                >
                  <RefreshCw className={`h-3 w-3 ${vizRefreshing ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {/* ── Topology ── */}
              <TabsContent value="topology" className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  {[
                    { label: "NVLink", color: "bg-green-500", desc: "High speed" },
                    { label: "SXM", color: "bg-amber-500", desc: "Ultra high speed" },
                    { label: "PCIe", color: "bg-indigo-500", desc: "Standard" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
                      <span className="font-medium">{l.label}</span>
                      <span className="text-muted-foreground">{l.desc}</span>
                    </div>
                  ))}
                </div>
                <Suspense fallback={<VizLoading text="Loading topology..." />}>
                  <GPUTopologyMap data={topologyData} />
                </Suspense>
              </TabsContent>

              {/* ── Heatmap ── */}
              <TabsContent value="heatmap" className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    {[
                      { icon: Activity, label: "Utilization", color: "text-blue-500" },
                      { icon: Thermometer, label: "Temperature", color: "text-red-500" },
                      { icon: Zap, label: "Power", color: "text-amber-500" },
                      { icon: HardDrive, label: "Memory", color: "text-purple-500" },
                    ].map((m) => {
                      const Icon = m.icon;
                      return (
                        <div key={m.label} className="flex items-center gap-1">
                          <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                          <span className="text-muted-foreground">{m.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <ToggleGroup
                    type="single"
                    value={String(heatmapHours)}
                    onValueChange={(v) => {
                      if (!v) return;
                      setHeatmapHours(Number(v));
                      setAdvancedDataLoaded(false);
                    }}
                    className="h-7"
                  >
                    {[2, 6, 12, 24].map((h) => (
                      <ToggleGroupItem key={h} value={String(h)} className="text-xs px-2.5 h-7">
                        {h}h
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <Suspense fallback={<VizLoading text="Loading heatmap..." />}>
                  {heatmapData ? (
                    <GPU3DHeatmap data={heatmapData} />
                  ) : (
                    <VizEmpty text="No heatmap data available. Data appears once hosts report historical metrics." />
                  )}
                </Suspense>
              </TabsContent>

              {/* ── Timeline ── */}
              <TabsContent value="timeline" className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap text-xs">
                  {[
                    { label: "Model Loading", color: "bg-blue-500", icon: Layers },
                    { label: "Inference", color: "bg-emerald-500", icon: Brain },
                    { label: "GPU Allocation", color: "bg-violet-500", icon: Cpu },
                    { label: "Training", color: "bg-blue-400", icon: Cable },
                  ].map((l) => {
                    const Icon = l.icon;
                    return (
                      <div key={l.label} className="flex items-center gap-1.5">
                        <div className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                        <Icon className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">{l.label}</span>
                      </div>
                    );
                  })}
                </div>
                <Suspense fallback={<VizLoading text="Loading timeline..." />}>
                  {timelineData ? (
                    <AIWorkloadTimeline data={timelineData} />
                  ) : (
                    <VizEmpty text="No timeline data. Workload events appear as Ollama processes requests." />
                  )}
                </Suspense>
              </TabsContent>
            </Tabs>
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
                onRefresh={fetchAllHostsData}
                ollama={host.ollama}
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
          <TabsContent value="settings" className="space-y-6">
            {/* Dashboard Access */}
            <DashboardAccessCard />

            {/* Global Settings */}
            <Card className="control-panel">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Global Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Demo Mode</Label>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={demo}
                        onChange={(e) => handleDemoToggle(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-muted-foreground">
                        {demo ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Refresh Interval</Label>
                    <Select value={refreshInterval.toString()} onValueChange={handleRefreshInterval}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Manual</SelectItem>
                        <SelectItem value="2000">2 seconds</SelectItem>
                        <SelectItem value="3000">3 seconds</SelectItem>
                        <SelectItem value="5000">5 seconds</SelectItem>
                        <SelectItem value="10000">10 seconds</SelectItem>
                        <SelectItem value="30000">30 seconds</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Energy Rate ($/kWh)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.12"
                      value={energyRate || ""}
                      onChange={(e) => handleEnergyRate(e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* GPU Host Management */}
            {!demo && (
              <HostManager 
                hosts={hosts} 
                setHosts={(newHosts) => {
                  setHosts(newHosts);
                  // Trigger immediate data fetch for new hosts
                  if (newHosts.length > hosts.length) {
                    fetchAllHostsData();
                  }
                }}
                onHostStatusChange={() => {}} 
              />
            )}

            {/* Exporter Configuration — auth, monitoring, network */}
            {!demo && <ConfigPanel hosts={hosts} />}

            {/* System Status — auth, persistence, features per host */}
            {!demo && <SystemStatus hosts={hosts} />}
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t bg-card/50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <div>Accelera v2.0 - High-Performance GPU Acceleration Platform</div>
            <div className="flex items-center space-x-4">
              {(totalGpus > 0 || totalOllamaModels > 0) && (
                <div className="flex items-center gap-4">
                  {totalGpus > 0 && (
                    <span>
                      {totalGpus} GPU{totalGpus !== 1 ? 's' : ''} across {connectedHosts.length} host{connectedHosts.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  {totalOllamaModels > 0 && (
                    <span>
                      {totalOllamaModels} AI model{totalOllamaModels !== 1 ? 's' : ''} on {hostsWithOllama} host{hostsWithOllama !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function DashboardAccessCard() {
  const { authEnabled, logout, setPassword, clearPassword } = useAuth();
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");

  const handleSetPassword = () => {
    if (!newPass || newPass !== confirmPass) {
      toast.error("Passwords do not match");
      return;
    }
    setPassword(newPass);
    setNewPass("");
    setConfirmPass("");
    toast.success("Dashboard password set");
  };

  const handleRemovePassword = () => {
    clearPassword();
    toast.success("Dashboard password removed — access is now open");
  };

  return (
    <Card className="control-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Dashboard Access
          </span>
          {authEnabled && (
            <Button variant="outline" size="sm" onClick={logout} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {authEnabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Dashboard is password-protected. You can change or remove the password below.
            </p>
            <div className="grid gap-3 md:grid-cols-3 items-end">
              <div className="space-y-1">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="New password"
                />
              </div>
              <div className="space-y-1">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSetPassword}
                  disabled={!newPass || !confirmPass}
                >
                  Change Password
                </Button>
                <Button variant="destructive" onClick={handleRemovePassword}>
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              No password is set. Anyone with access to this URL can view the dashboard.
              Set a password to require authentication.
            </p>
            <div className="grid gap-3 md:grid-cols-3 items-end">
              <div className="space-y-1">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="Choose a password"
                />
              </div>
              <div className="space-y-1">
                <Label>Confirm Password</Label>
                <Input
                  type="password"
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>
              <Button
                onClick={handleSetPassword}
                disabled={!newPass || !confirmPass}
              >
                Set Password
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VizLoading({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{text}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function VizEmpty({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <BarChart3 className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}