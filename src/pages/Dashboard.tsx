import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { useFleetHosts } from "@/hooks/useFleetHosts";
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
import { Monitor, BarChart3, Cog, TrendingUp, Bell, ShieldAlert, DollarSign } from "lucide-react";
import { CostAnalysisTab } from "@/components/CostAnalysisTab";
import { TabErrorBoundary } from "@/components/TabErrorBoundary";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { proxyUrl } from "@/lib/proxy";
import { useTheme } from "@/hooks/useTheme";

interface HeatmapResponse {
  hosts?: unknown[];
  timestamps?: unknown[];
  metrics?: {
    utilization?: unknown[];
    temperature?: unknown[];
    power?: unknown[];
    memory?: unknown[];
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
  const { currency, setCurrency } = useCurrency();
  const { theme, toggle: toggleTheme } = useTheme();
  const { hosts, setHosts, hostsData, fetchAllHostsData } = useFleetHosts({ demo, refreshInterval });
  const [activeTab, setActiveTab] = useState("overview");
  const { data: topologyData } = useTopology();
  const [heatmapData, setHeatmapData] = useState(null);
  const [advancedDataLoaded, setAdvancedDataLoaded] = useState(false);
  const [heatmapHours, setHeatmapHours] = useState(6);
  const [vizRefreshing, setVizRefreshing] = useState(false);
  const hostDataMap = new Map(
    hostsData.map(host => [host.url, { gpus: host.gpus, timestamp: host.timestamp }])
  );


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

          const results: { host: string; heatmap: HeatmapResponse | null } = { host: host.name, heatmap: null };

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
            <TabsTrigger value="costs" className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Cost Analysis
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
            <TabErrorBoundary name="Overview">
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
            </TabErrorBoundary>
          </TabsContent>

          {/* Cost Analysis Tab */}
          <TabsContent value="costs" className="space-y-4">
            <TabErrorBoundary name="Cost Analysis">
              <CostAnalysisTab hosts={hosts} />
            </TabErrorBoundary>
          </TabsContent>

          {/* Advanced Visualizations Tab */}
          <TabsContent value="visualizations" className="space-y-4">
            <TabErrorBoundary name="Advanced Visualizations">
            <VisualizationsTab
              topologyData={topologyData}
              hosts={hosts}
              heatmapData={heatmapData}
              heatmapHours={heatmapHours}
              setHeatmapHours={setHeatmapHours}
              advancedDataLoaded={advancedDataLoaded}
              setAdvancedDataLoaded={setAdvancedDataLoaded}
              fetchAdvancedVisualizationData={fetchAdvancedVisualizationData}
              vizRefreshing={vizRefreshing}
              setVizRefreshing={setVizRefreshing}
            />
            </TabErrorBoundary>
          </TabsContent>

          {/* Individual Host Tabs */}
          {hostsData.map((host) => (
            <TabsContent key={host.url} value={host.url}>
              <TabErrorBoundary name={host.name}>
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
              </TabErrorBoundary>
            </TabsContent>
          ))}

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="space-y-6">
            <TabErrorBoundary name="Alerts">
              <AlertsManager />
            </TabErrorBoundary>
          </TabsContent>

          {/* GPU Health Events Tab */}
          <TabsContent value="gpu-events" className="space-y-6">
            <TabErrorBoundary name="GPU Health">
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
            </TabErrorBoundary>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <TabErrorBoundary name="Settings">
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
            </TabErrorBoundary>
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
