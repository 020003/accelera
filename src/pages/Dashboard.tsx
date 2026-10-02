import { useState, useEffect, useCallback } from "react";
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
import { CommandPalette, DASHBOARD_SECTIONS } from "@/components/CommandPalette";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { exportFleetCsv } from "@/lib/fleetMetrics";

type PerformanceMode = "realtime" | "balanced" | "low-load" | "manual";

const PERFORMANCE_INTERVALS: Record<PerformanceMode, number> = {
  realtime: 2000,
  balanced: 5000,
  "low-load": 30000,
  manual: 0,
};

const SECTION_TABS = new Set<string>(DASHBOARD_SECTIONS.map((s) => s.value));

// Active tab is mirrored into the URL hash (`#tab=<value>`) so views can be bookmarked and shared.
function readTabFromHash(): string {
  const match = window.location.hash.match(/^#tab=(.+)$/);
  if (!match) return "overview";
  try {
    return decodeURIComponent(match[1]) || "overview";
  } catch {
    return "overview";
  }
}

const RUNTIME_BADGES = [
  { key: "ollama", letter: "O", label: "Ollama", className: "bg-purple-500/15 text-purple-400 ring-purple-500/30" },
  { key: "sglang", letter: "S", label: "SGLang", className: "bg-cyan-500/15 text-cyan-400 ring-cyan-500/30" },
  { key: "vllm", letter: "V", label: "vLLM", className: "bg-orange-500/15 text-orange-400 ring-orange-500/30" },
] as const;

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
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>(() =>
    (localStorage.getItem("gpu_monitor_performance_mode") as PerformanceMode) || "balanced"
  );
  const [refreshInterval, setRefreshInterval] = useState<number>(() => 
    parseInt(localStorage.getItem("gpu_monitor_refresh_interval") || String(PERFORMANCE_INTERVALS.balanced))
  );
  const [energyRate, setEnergyRate] = useState<number>(() => 
    parseFloat(localStorage.getItem("gpu_monitor_energy_rate") || "0")
  );
  const { currency, setCurrency } = useCurrency();
  const { theme, toggle: toggleTheme } = useTheme();
  const {
    hosts,
    setHosts,
    hostsLoaded,
    hostsData,
    fleetFreshness,
    fleetFetchDurationMs,
    cacheTtlSeconds,
    runtimeCacheTtlSeconds,
    fetchAllHostsData,
  } = useFleetHosts({ demo, refreshInterval });
  const [activeTab, setActiveTabState] = useState<string>(readTabFromHash);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const setActiveTab = useCallback((tab: string) => {
    setActiveTabState(tab);
    const hash = tab === "overview" ? "" : `#tab=${encodeURIComponent(tab)}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveTabState(readTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Fall back to the overview when a bookmarked host tab no longer exists. Host tabs are
  // rendered from the polled snapshot (hostsData), so validate against it once it has arrived.
  useEffect(() => {
    if (!hostsLoaded || demo || SECTION_TABS.has(activeTab)) return;
    if (hostsData.length === 0 && hosts.length > 0) return;
    if (!hostsData.some((h) => h.url === activeTab)) setActiveTab("overview");
  }, [hostsLoaded, demo, hosts.length, hostsData, activeTab, setActiveTab]);
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
    const matchingMode = Object.entries(PERFORMANCE_INTERVALS).find(([, ms]) => ms === interval)?.[0] as PerformanceMode | undefined;
    if (matchingMode) {
      setPerformanceMode(matchingMode);
      localStorage.setItem("gpu_monitor_performance_mode", matchingMode);
    }
  };

  const handlePerformanceMode = (mode: PerformanceMode) => {
    setPerformanceMode(mode);
    localStorage.setItem("gpu_monitor_performance_mode", mode);
    const interval = PERFORMANCE_INTERVALS[mode];
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
  const offlineHosts = hostsData.filter(h => !h.isConnected).length;
  const fleetUtil = totalGpus > 0
    ? Math.round(connectedHosts.reduce((s, h) => s + h.gpus.reduce((a, g) => a + g.utilization, 0), 0) / totalGpus)
    : 0;
  const pageTitle = hostsData.length > 0
    ? `${offlineHosts > 0 ? `(${offlineHosts} offline) ` : ""}Accelera · ${connectedHosts.length}/${hostsData.length} hosts · ${fleetUtil}% util`
    : "Accelera - High-Performance GPU Acceleration Platform";

  return (
    <div className="dashboard-canvas min-h-screen bg-background">
      <Helmet>
        <title>{pageTitle}</title>
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
        hostsWithVllm={hostsWithVllm}
        performanceMode={performanceMode}
        refreshInterval={refreshInterval}
        fleetFetchDurationMs={fleetFetchDurationMs}
        fleetFreshness={fleetFreshness}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hostsData={hostsData}
        onNavigate={setActiveTab}
        onRefresh={() => {
          fetchAllHostsData();
          toast.success("Refreshing fleet data");
        }}
        onToggleTheme={toggleTheme}
        theme={theme}
        onExportCsv={() => exportFleetCsv(hostsData)}
        performanceMode={performanceMode}
        onPerformanceMode={(mode) => {
          handlePerformanceMode(mode);
          toast.info(`Refresh mode: ${mode.replace("-", " ")}`);
        }}
      />

      <main className="mx-auto max-w-[1800px] space-y-6 px-4 py-5 sm:px-6 sm:py-6">

        {/* Tabbed Interface */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="nav-scroller sticky top-[65px] z-40 -mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="nav-strip flex h-auto min-w-max flex-nowrap justify-start gap-1 rounded-xl p-1.5">
            <TabsTrigger value="overview" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <BarChart3 className="h-4 w-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="visualizations" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <TrendingUp className="h-4 w-4" />
              Advanced Visualizations
            </TabsTrigger>
            <TabsTrigger value="costs" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <DollarSign className="h-4 w-4" />
              Cost Analysis
            </TabsTrigger>
            {hostsData.map((host) => (
              <TabsTrigger key={host.url} value={host.url} className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
                <Monitor className="h-4 w-4" />
                {host.name}
                <span
                  className={`h-2 w-2 rounded-full ${host.isConnected ? (host.stale ? "bg-amber-500" : "bg-accelera-green") : "bg-red-500"}`}
                  aria-label={host.isConnected ? (host.stale ? "stale" : "online") : "offline"}
                />
                {RUNTIME_BADGES.filter((b) => host[b.key]?.isAvailable).map((b) => (
                  <Tooltip key={b.key}>
                    <TooltipTrigger asChild>
                      <span
                        className={`rounded px-1 py-0.5 text-[9px] font-semibold leading-none ring-1 ring-inset ${b.className}`}
                        aria-label={`${b.label}: ${host[b.key]?.models.length ?? 0} model(s)`}
                      >
                        {b.letter}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      {b.label} · {host[b.key]?.models.length ?? 0} model{(host[b.key]?.models.length ?? 0) !== 1 ? "s" : ""}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </TabsTrigger>
            ))}
            <TabsTrigger value="alerts" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <Bell className="h-4 w-4" />
              Alerts
            </TabsTrigger>
            <TabsTrigger value="gpu-events" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <ShieldAlert className="h-4 w-4" />
              GPU Health
            </TabsTrigger>
            <TabsTrigger value="settings" className="h-9 shrink-0 gap-1.5 rounded-lg px-3 text-xs data-[state=active]:shadow-sm">
              <Cog className="h-4 w-4" />
              Settings
            </TabsTrigger>
          </TabsList>
          </div>

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
                <MultiHostOverview
                  hostsData={hostsData}
                  energyRate={energyRate}
                  currencySymbol={currency.symbol}
                  fleetFreshness={fleetFreshness}
                  onSelectHost={setActiveTab}
                />
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
              liveHosts={hostsData}
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
                snapshotSource={host.snapshotSource}
                stale={host.stale}
                fetchedAt={host.fetchedAt}
                lastSuccessAt={host.lastSuccessAt}
                fetchDurationMs={host.fetchDurationMs}
                cacheAgeSeconds={host.cacheAgeSeconds}
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
              performanceMode={performanceMode}
              handlePerformanceMode={handlePerformanceMode}
              cacheTtlSeconds={cacheTtlSeconds}
              runtimeCacheTtlSeconds={runtimeCacheTtlSeconds}
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
