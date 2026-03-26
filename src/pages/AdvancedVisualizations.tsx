import { useState, useEffect, useCallback, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GPUTopologyMap } from "@/components/GPUTopologyMap";
import { GPU3DHeatmap } from "@/components/GPU3DHeatmap";
import { AIWorkloadTimeline } from "@/components/AIWorkloadTimeline";
import {
  NetworkIcon,
  BarChart3,
  Clock,
  ArrowLeft,
  RefreshCw,
  Server,
  Activity,
  Thermometer,
  Zap,
  HardDrive,
  Loader2,
  Layers,
  Brain,
  Cpu,
  Cable,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTopology } from "@/hooks/useTopology";

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
  const {
    data: topologyData,
    loading: topologyLoading,
    error: topologyError,
  } = useTopology();

  const [heatmapData, setHeatmapData] = useState<any>(null);
  const [timelineData, setTimelineData] = useState<any>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
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
            `${baseUrl(h.url)}/api/heatmap?metric=utilization&hours=${heatmapHours}`,
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

  // Fetch timeline from all hosts and merge
  const fetchTimeline = useCallback(async () => {
    if (hosts.length === 0) return;
    setTimelineLoading(true);
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      const results = await Promise.allSettled(
        hosts.map((h) =>
          fetch(`${baseUrl(h.url)}/api/timeline`, { signal: ctrl.signal }).then(
            (r) => (r.ok ? r.json() : null)
          )
        )
      );
      clearTimeout(timeout);
      const valid = results
        .filter(
          (r): r is PromiseFulfilledResult<any> =>
            r.status === "fulfilled" && r.value?.events
        )
        .map((r) => r.value);
      if (valid.length > 0) {
        const allEvents = valid.flatMap((v: any, idx: number) =>
          v.events.map((e: any) => ({ ...e, id: `h${idx}-${e.id}` }))
        );
        setTimelineData({
          events: allEvents,
          hosts: [
            ...new Set(
              valid.flatMap((v: any) =>
                v.events.map((e: any) => e.host)
              )
            ),
          ],
        });
      }
    } catch {
      /* ignore */
    }
    setTimelineLoading(false);
  }, [hosts]);

  // Lazy-load data when tab becomes active
  useEffect(() => {
    if (activeTab === "heatmap" && !heatmapData) fetchHeatmap();
    if (activeTab === "timeline" && !timelineData) fetchTimeline();
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
    if (activeTab === "timeline") fetchTimeline();
  };

  const isCurrentLoading =
    (activeTab === "topology" && topologyLoading) ||
    (activeTab === "heatmap" && heatmapLoading) ||
    (activeTab === "timeline" && timelineLoading);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Helmet>
        <title>Advanced Visualizations - Accelera</title>
      </Helmet>

      {/* ── Compact header ── */}
      <header className="border-b bg-card/50 sticky top-0 z-30 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="sm" className="gap-1.5 h-8 -ml-2">
                <ArrowLeft className="h-3.5 w-3.5" />
                Dashboard
              </Button>
            </Link>
            <div className="h-5 w-px bg-border" />
            <h1 className="text-sm font-semibold">Advanced Visualizations</h1>
            <Badge variant="secondary" className="text-[10px] h-5 gap-1">
              <Server className="h-3 w-3" />
              {hosts.length} host{hosts.length !== 1 ? "s" : ""}
            </Badge>
          </div>
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
      </header>

      {/* ── Main ── */}
      <main className="flex-1 container mx-auto px-4 py-4 space-y-4">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
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

          {/* ───── Topology ───── */}
          <TabsContent value="topology" className="space-y-3">
            {/* Compact legend */}
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

            {topologyLoading ? (
              <LoadingPlaceholder text="Loading GPU topology..." />
            ) : topologyError ? (
              <ErrorPlaceholder text="Failed to load topology data. Check host connectivity." />
            ) : (
              <GPUTopologyMap data={topologyData} />
            )}
          </TabsContent>

          {/* ───── Heatmap ───── */}
          <TabsContent value="heatmap" className="space-y-3">
            {/* Controls */}
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
                onValueChange={(v) => v && setHeatmapHours(Number(v))}
                className="h-7"
              >
                {HEATMAP_HOURS.map((r) => (
                  <ToggleGroupItem
                    key={r.hours}
                    value={String(r.hours)}
                    className="text-xs px-2.5 h-7"
                  >
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            {heatmapLoading ? (
              <LoadingPlaceholder text="Loading heatmap data..." />
            ) : !heatmapData ? (
              <ErrorPlaceholder text="No heatmap data available. Ensure hosts are connected and have historical data." />
            ) : (
              <GPU3DHeatmap data={heatmapData} />
            )}
          </TabsContent>

          {/* ───── Timeline ───── */}
          <TabsContent value="timeline" className="space-y-3">
            {/* Compact legend */}
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

            {timelineLoading ? (
              <LoadingPlaceholder text="Loading timeline data..." />
            ) : !timelineData ? (
              <ErrorPlaceholder text="No timeline data available. Workload events appear as Ollama processes requests." />
            ) : (
              <AIWorkloadTimeline data={timelineData} />
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
      <CardContent className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Spinner className="h-5 w-5" />
          <span className="text-sm">{text}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ErrorPlaceholder({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <BarChart3 className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}