import { useState, useEffect, lazy, Suspense } from "react";
import { Helmet } from "react-helmet-async";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import { HostManager } from "@/components/HostManager";
import { MultiHostOverview } from "@/components/MultiHostOverview";
import { HostTab } from "@/components/HostTab";
import { PowerUsageChart } from "@/components/PowerUsageChart";

// Lazy load heavy visualization components
const GPUTopologyMap = lazy(() => import("@/components/GPUTopologyMap").then(m => ({ default: m.GPUTopologyMap })));
const GPU3DHeatmap = lazy(() => import("@/components/GPU3DHeatmap").then(m => ({ default: m.GPU3DHeatmap })));
const AIWorkloadTimeline = lazy(() => import("@/components/AIWorkloadTimeline").then(m => ({ default: m.AIWorkloadTimeline })));
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Monitor, BarChart3, Settings, Cog, Bot, TrendingUp, ExternalLink, NetworkIcon, Clock } from "lucide-react";
import { Link } from "react-router-dom";
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
  const [topologyData, setTopologyData] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [timelineData, setTimelineData] = useState(null);
  const [advancedDataLoaded, setAdvancedDataLoaded] = useState(false);
  
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
          
          // Fetch all APIs for this host in parallel
          const [topologyResponse, heatmapResponse, timelineResponse] = await Promise.allSettled([
            fetch(`${baseUrl}/api/topology`, { signal: timeoutController.signal }),
            fetch(`${baseUrl}/api/heatmap?metric=utilization&hours=2`, { signal: timeoutController.signal }), // Reduced hours for faster loading
            fetch(`${baseUrl}/api/timeline`, { signal: timeoutController.signal })
          ]);

          const results = { host: host.name, topology: null, heatmap: null, timeline: null };

          if (topologyResponse.status === 'fulfilled' && topologyResponse.value.ok) {
            results.topology = await topologyResponse.value.json();
          }
          if (heatmapResponse.status === 'fulfilled' && heatmapResponse.value.ok) {
            results.heatmap = await heatmapResponse.value.json();
          }
          if (timelineResponse.status === 'fulfilled' && timelineResponse.value.ok) {
            results.timeline = await timelineResponse.value.json();
          }

          return results;
        } catch (error) {
          console.error(`Error fetching data from ${host.name}:`, error);
          return { host: host.name, topology: null, heatmap: null, timeline: null };
        }
      });

      const hostResults = await Promise.all(hostPromises);
      clearTimeout(timeoutId);

      // Process topology data
      const allTopologyGpus = hostResults
        .filter(result => result.topology && result.topology.gpus)
        .flatMap(result => result.topology.gpus.map(gpu => ({ ...gpu, host: result.host })));

      if (allTopologyGpus.length > 0) {
        setTopologyData({ gpus: allTopologyGpus });
      }

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
        const combinedTimeline = {
          events: validTimelineResults.flatMap(result => result.timeline.events),
          hosts: [...new Set(validTimelineResults.flatMap(result => result.timeline.events.map(event => event.host)))]
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

      // Check for Ollama availability asynchronously (don't block main loading)
      checkOllamaAvailability(host.url).then(ollamaInfo => {
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
        // Silently fail Ollama check to not block GPU monitoring
      });
      
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
    setHostsData(results);
    
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
          <TabsContent value="visualizations" className="space-y-6">
            <Tabs defaultValue="topology" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="topology" className="flex items-center gap-2">
                  <NetworkIcon className="h-4 w-4" />
                  GPU Topology
                </TabsTrigger>
                <TabsTrigger value="heatmap" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  3D Heatmap
                </TabsTrigger>
                <TabsTrigger value="timeline" className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  AI Timeline
                </TabsTrigger>
              </TabsList>

              <TabsContent value="topology">
                <Suspense fallback={<div className="h-[400px] flex items-center justify-center">Loading topology visualization...</div>}>
                  <GPUTopologyMap data={topologyData} />
                </Suspense>
              </TabsContent>

              <TabsContent value="heatmap">
                <Suspense fallback={<div className="h-[400px] flex items-center justify-center">Loading 3D heatmap...</div>}>
                  <GPU3DHeatmap data={heatmapData} />
                </Suspense>
              </TabsContent>

              <TabsContent value="timeline">
                <Suspense fallback={<div className="h-[400px] flex items-center justify-center">Loading timeline visualization...</div>}>
                  <AIWorkloadTimeline data={timelineData} />
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

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
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