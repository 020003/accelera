import { useState, useEffect, useCallback, useMemo } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Helmet } from "react-helmet-async";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GPUTopologyMap } from "@/components/GPUTopologyMap";
import { GPU3DHeatmap } from "@/components/GPU3DHeatmap";
import {
  NetworkIcon,
  BarChart3,
  ArrowLeft,
  RefreshCw,
  Server,
  Activity,
  Thermometer,
  Zap,
  HardDrive,
  Loader2,
  Sun,
  Moon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTopology } from "@/hooks/useTopology";
import { useTheme } from "@/hooks/useTheme";

interface Host {
  url: string;
  name: string;
}

const HEATMAP_HOURS = [
  { label: "2h", hours: 2 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
] as const;

function getHosts(): Host[] {
  try {
    return JSON.parse(localStorage.getItem("gpu_monitor_hosts") || "[]");
  } catch {
    return [];
  }
}

function baseUrl(hostUrl: string): string {
  try {
    const u = new URL(hostUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return hostUrl.replace(/\/nvidia-smi\.json$/, "");
  }
}

function Spinner({ className = "" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export default function AdvancedVisualizations() {
  const hosts = useMemo(getHosts, []);
  const { theme, toggle: toggleTheme } = useTheme();
  const {
    data: topologyData,
    loading: topologyLoading,
    error: topologyError,
  } = useTopology();

  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapHours, setHeatmapHours] = useState(6);
  const [activeTab, setActiveTab] = useState("topology");

  // Fetch heatmap from all hosts and merge
  const fetchHeatmap = useCallback(async () => {
    if (hosts.length === 0) return;
    setHeatmapLoading(true);
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      const results = await Promise.allSettled(
        hosts.map((h) =>
          fetch(
            proxyUrl(`${baseUrl(h.url)}/api/heatmap?metric=utilization&hours=${heatmapHours}`),
            { signal: ctrl.signal }
          ).then((r) => (r.ok ? r.json() : null))
        )
      );
      clearTimeout(timeout);
      const valid = results
        .filter(
          (r): r is PromiseFulfilledResult<any> =>
            r.status === "fulfilled" && r.value?.hosts
        )
        .map((r) => r.value);
      if (valid.length > 0) {
        setHeatmapData({
          hosts: valid.flatMap((v: any) => v.hosts),
          timestamps: valid[0].timestamps,
          metrics: {
            utilization: valid.flatMap((v: any) => v.metrics?.utilization || []),
            temperature: valid.flatMap((v: any) => v.metrics?.temperature || []),
            power: valid.flatMap((v: any) => v.metrics?.power || []),
            memory: valid.flatMap((v: any) => v.metrics?.memory || []),
          },
        });
      }
    } catch {
      /* ignore */
    }
    setHeatmapLoading(false);
  }, [hosts, heatmapHours]);


  // Lazy-load data when tab becomes active
  useEffect(() => {
    if (activeTab === "heatmap" && !heatmapData) fetchHeatmap();
  }, [activeTab]);

  // Re-fetch heatmap when hours change
  useEffect(() => {
    if (activeTab === "heatmap") fetchHeatmap();
  }, [heatmapHours]);

  const handleRefresh = () => {
    if (activeTab === "topology") {
      /* topology hook auto-refreshes */
    }
    if (activeTab === "heatmap") fetchHeatmap();
  };

  const isCurrentLoading =
    (activeTab === "topology" && topologyLoading) ||
    (activeTab === "heatmap" && heatmapLoading);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Advanced Visualizations - Accelera</title>
      </Helmet>

      {/* ── Header ── */}
      <header className="border-b bg-card/60 backdrop-blur-md sticky top-0 z-30">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5 h-8 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Button>
            </Link>
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-semibold tracking-tight">Advanced Visualizations</h1>
            <Badge variant="secondary" className="text-[10px] h-5 gap-1">
              <Server className="h-3 w-3" />
              {hosts.length} host{hosts.length !== 1 ? "s" : ""}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5"
              onClick={handleRefresh}
              disabled={isCurrentLoading}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isCurrentLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="flex-1 container mx-auto px-4 py-6 space-y-5">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-5"
        >
          <TabsList className="h-10">
            <TabsTrigger value="topology" className="gap-2 text-sm px-4">
              <NetworkIcon className="h-4 w-4" />
              GPU Topology
            </TabsTrigger>
            <TabsTrigger value="heatmap" className="gap-2 text-sm px-4">
              <BarChart3 className="h-4 w-4" />
              Cluster Heatmap
            </TabsTrigger>
          </TabsList>

          {/* ───── Topology ───── */}
          <TabsContent value="topology" className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-5 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Legend</span>
                  {[
                    { label: "NVLink", color: "bg-green-500", desc: "High speed" },
                    { label: "SXM", color: "bg-amber-500", desc: "Ultra high speed" },
                    { label: "PCIe", color: "bg-indigo-500", desc: "Standard" },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-2.5 h-2.5 rounded-full ${l.color} shadow-sm`} />
                      <span className="font-medium text-foreground">{l.label}</span>
                      <span className="text-muted-foreground">{l.desc}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {topologyLoading ? (
              <LoadingPlaceholder text="Loading GPU topology..." />
            ) : topologyError ? (
              <ErrorPlaceholder text="Failed to load topology data. Check host connectivity." />
            ) : (
              <GPUTopologyMap data={topologyData} />
            )}
          </TabsContent>

          {/* ───── Heatmap ───── */}
          <TabsContent value="heatmap" className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="py-3 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-5 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Metrics</span>
                    {[
                      { icon: Activity, label: "Utilization", color: "text-blue-500" },
                      { icon: Thermometer, label: "Temperature", color: "text-red-500" },
                      { icon: Zap, label: "Power", color: "text-amber-500" },
                      { icon: HardDrive, label: "Memory", color: "text-purple-500" },
                    ].map((m) => {
                      const Icon = m.icon;
                      return (
                        <div key={m.label} className="flex items-center gap-1.5 text-xs">
                          <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                          <span className="text-foreground">{m.label}</span>
                        </div>
                      );
                    })}
                  </div>
                  <ToggleGroup
                    type="single"
                    value={String(heatmapHours)}
                    onValueChange={(v) => v && setHeatmapHours(Number(v))}
                    className="h-8"
                  >
                    {HEATMAP_HOURS.map((r) => (
                      <ToggleGroupItem
                        key={r.hours}
                        value={String(r.hours)}
                        className="text-xs px-3 h-8"
                      >
                        {r.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </CardContent>
            </Card>

            {heatmapLoading ? (
              <LoadingPlaceholder text="Loading heatmap data..." />
            ) : !heatmapData ? (
              <ErrorPlaceholder text="No heatmap data available. Ensure hosts are connected and have historical data." />
            ) : (
              <GPU3DHeatmap data={heatmapData} />
            )}
          </TabsContent>


        </Tabs>
      </main>
    </div>
  );
}

function LoadingPlaceholder({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-24 gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          <Spinner className="h-6 w-6 text-primary relative" />
        </div>
        <span className="text-sm text-muted-foreground">{text}</span>
      </CardContent>
    </Card>
  );
}

function ErrorPlaceholder({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <div className="rounded-full p-4 bg-muted/50">
          <BarChart3 className="h-8 w-8 opacity-40" />
        </div>
        <p className="text-sm max-w-md text-center">{text}</p>
      </CardContent>
    </Card>
  );
}