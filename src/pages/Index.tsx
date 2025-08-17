import { useEffect, useMemo, useState, useRef } from "react";
import { Helmet } from "react-helmet-async";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useNvidiaSmi } from "@/hooks/useNvidiaSmi";
import { GpuCard } from "@/components/GpuCard";
import { GpuHistoryPanel } from "@/components/GpuHistoryPanel";
import type { NvidiaSmiResponse } from "@/types/gpu";
import { toast } from "sonner";
import { useGpuHistory } from "@/hooks/useGpuHistory";
import { usePowerHistory } from "@/hooks/usePowerHistory";
import type { PowerPoint } from "@/hooks/usePowerHistory";
import { Zap, Activity, Thermometer, Gauge } from "lucide-react";

// Integrate power (W) over time to kWh using trapezoidal rule
function kwhFromSeries(series: PowerPoint[]): number {
  let kwh = 0;
  for (let i = 1; i < series.length; i++) {
    const dt = series[i].t - series[i - 1].t; // ms
    if (dt <= 0) continue;
    const avgW = (series[i].power + series[i - 1].power) / 2;
    kwh += (avgW * dt) / 3600000000; // 3.6e9 ms per kWh
  }
  return kwh;
}

const Index = () => {
  const [apiUrl, setApiUrl] = useState<string | null>(() => localStorage.getItem("nvidia_api_url"));
  const [inputUrl, setInputUrl] = useState<string>(apiUrl ?? "");
  const [demo, setDemo] = useState<boolean>(() => localStorage.getItem("nvidia_demo") === "1");
  const [intervalMs, setIntervalMs] = useState<number>(() => Number(localStorage.getItem("nvidia_interval_ms")) || 5000);
  const [hosts, setHosts] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("nvidia_hosts") || "[]");
    } catch {
      return [];
    }
  });
const [energyRate, setEnergyRate] = useState<number>(() => Number(localStorage.getItem("nvidia_energy_rate")) || 0);
const [hostWatts, setHostWatts] = useState<Record<string, number>>({});
const [hostKwh24, setHostKwh24] = useState<Record<string, number>>({});

// Aggregates for multi-host KPIs
const [hostGpuCounts, setHostGpuCounts] = useState<Record<string, number>>({});
const [hostUtilSums, setHostUtilSums] = useState<Record<string, number>>({});
const [hostTempSums, setHostTempSums] = useState<Record<string, number>>({});

const [selectedMainId, setSelectedMainId] = useState<string | null>(null);
const [historyMinutes, setHistoryMinutes] = useState<number>(() => Number(localStorage.getItem("nvidia_history_minutes")) || 10);

// Alerts
const [alertTemp, setAlertTemp] = useState<number>(() => Number(localStorage.getItem("nvidia_alert_temp")) || 80);
const [alertUtil, setAlertUtil] = useState<number>(() => Number(localStorage.getItem("nvidia_alert_util")) || 95);
const lastAlertRef = useRef<Record<string, number>>({});

  const { data, isError, error, isFetching } = useNvidiaSmi({ apiUrl: demo ? null : apiUrl, demo, refetchIntervalMs: intervalMs });
  const maxPoints = useMemo(() => Math.max(60, Math.round((historyMinutes * 60 * 1000) / Math.max(1, intervalMs || 5000))), [historyMinutes, intervalMs]);
  const history = useGpuHistory({ data, intervalMs, maxPoints });
  const singlePowerHist = usePowerHistory({ data, hostKey: demo ? "demo" : (apiUrl || "local"), retentionHours: 24 });

  useEffect(() => {
    if (isError) {
      toast.error("Failed to fetch NVIDIA SMI data. Showing demo data.");
    }
  }, [isError]);

  const handleSave = () => {
    const cleaned = inputUrl.trim() || null;
    setApiUrl(cleaned);
    if (cleaned) {
      localStorage.setItem("nvidia_api_url", cleaned);
      toast.success("API URL saved.");
      setDemo(false);
      localStorage.setItem("nvidia_demo", "0");
    } else {
      localStorage.removeItem("nvidia_api_url");
    }
  };

  const handleDemoToggle = (checked: boolean) => {
    setDemo(checked);
    localStorage.setItem("nvidia_demo", checked ? "1" : "0");
  };

  const handleInterval = (value: string) => {
    const ms = Number(value);
    setIntervalMs(ms);
    localStorage.setItem("nvidia_interval_ms", String(ms));
  };

  const handleAddHost = () => {
    const cleaned = inputUrl.trim();
    if (!cleaned) return;
    setHosts((prev) => {
      const next = Array.from(new Set([...prev, cleaned]));
      localStorage.setItem("nvidia_hosts", JSON.stringify(next));
      return next;
    });
    setApiUrl(cleaned);
    localStorage.setItem("nvidia_api_url", cleaned);
    toast.success("Host added.");
  };

  const handleRemoveHost = (host: string) => {
    setHosts((prev) => {
      const next = prev.filter((h) => h !== host);
      localStorage.setItem("nvidia_hosts", JSON.stringify(next));
      return next;
    });
  };

  const HostSection = ({ host, onUpdate, onUpdateKwh, onUpdateStats }: { host: string; onUpdate: (watts: number) => void; onUpdateKwh: (kwh: number) => void; onUpdateStats: (s: { gpuCount: number; utilSum: number; tempSum: number }) => void }) => {
    const { data: hostData, isFetching: hostFetching } = useNvidiaSmi({ apiUrl: host, demo: false, refetchIntervalMs: intervalMs });
    const hostHistory = useGpuHistory({ data: hostData, intervalMs, maxPoints });
    const gpusHost = (hostData as NvidiaSmiResponse | undefined)?.gpus ?? [];
    const totalDraw = gpusHost.reduce((sum, g) => sum + (g.power?.draw || 0), 0);
    useEffect(() => { onUpdate(totalDraw); }, [totalDraw, onUpdate]);

    // KPI aggregates for this host
    const gpuCount = gpusHost.length;
    const utilSum = gpusHost.reduce((sum, g) => sum + (g.utilization || 0), 0);
    const tempSum = gpusHost.reduce((sum, g) => sum + (g.temperature || 0), 0);
    useEffect(() => { onUpdateStats({ gpuCount, utilSum, tempSum }); }, [gpuCount, utilSum, tempSum, onUpdateStats]);

    const powerHist = usePowerHistory({ data: hostData, hostKey: host, retentionHours: 24 });
    const hostKwh = useMemo(() => {
      const ids = gpusHost.map((g) => g.uuid ?? String(g.id));
      return ids.reduce((sum, id) => sum + kwhFromSeries(powerHist[id] || []), 0);
    }, [gpusHost, powerHist]);
    useEffect(() => { onUpdateKwh(hostKwh); }, [hostKwh, onUpdateKwh]);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    useEffect(() => {
      if (gpusHost.length > 0) {
        const firstId = gpusHost[0].uuid ?? String(gpusHost[0].id);
        setSelectedId((prev) => prev && gpusHost.some(g => (g.uuid ?? String(g.id)) === prev) ? prev : firstId);
      } else {
        setSelectedId(null);
      }
    }, [gpusHost]);

    const selectedGpu = useMemo(() => gpusHost.find(g => (g.uuid ?? String(g.id)) === selectedId), [gpusHost, selectedId]);
    const series = selectedId ? (hostHistory[selectedId] ?? []) : [];

    return (
      <section aria-label={`GPU Grid for ${host}`} className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{host}</h2>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {hostData?.timestamp ? <span>{new Date(hostData.timestamp).toLocaleString()}</span> : null}
            <span>• {Math.round(totalDraw)} W</span>
            {energyRate > 0 ? <span>• ${((totalDraw / 1000) * energyRate).toFixed(2)}/hr</span> : null}
          </div>
        </div>
        {gpusHost.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">No GPU data available.</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-4">
            <div className="lg:col-span-3">
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                {gpusHost.map((gpu) => {
                  const id = gpu.uuid ?? String(gpu.id);
                  return <GpuCard key={id} info={gpu} energyRate={energyRate} onSelect={() => setSelectedId(id)} selected={selectedId === id} />;
                })}
              </div>
            </div>
            <GpuHistoryPanel title={selectedGpu ? `${selectedGpu.name} • GPU ${selectedGpu.id} History` : "History"} series={series} />
          </div>
        )}
      </section>
    );
  };

  const gpus = (data as NvidiaSmiResponse | undefined)?.gpus ?? [];

  const totalWattsAll = useMemo(() => {
    if (hosts.length > 0 && !demo) {
      return Object.values(hostWatts).reduce((s, v) => s + v, 0);
    }
    return gpus.reduce((s, g) => s + (g.power?.draw || 0), 0);
  }, [hosts, demo, hostWatts, gpus]);

  const costHrAll = useMemo(() => (energyRate > 0 ? (totalWattsAll / 1000) * energyRate : 0), [totalWattsAll, energyRate]);

  const totalKwh24All = useMemo(() => {
    if (hosts.length > 0 && !demo) {
      return Object.values(hostKwh24).reduce((s, v) => s + v, 0);
    }
    const ids = gpus.map((g) => g.uuid ?? String(g.id));
    return ids.reduce((s, id) => s + kwhFromSeries(singlePowerHist[id] || []), 0);
  }, [hosts, demo, hostKwh24, gpus, singlePowerHist]);

  const cost24hAll = useMemo(() => (energyRate > 0 ? totalKwh24All * energyRate : 0), [totalKwh24All, energyRate]);

  useEffect(() => {
    if (gpus.length > 0) {
      const firstId = gpus[0].uuid ?? String(gpus[0].id);
      setSelectedMainId((prev) => prev && gpus.some(g => (g.uuid ?? String(g.id)) === prev) ? prev : firstId);
    } else {
      setSelectedMainId(null);
    }
  }, [gpus]);

  const selectedGpuMain = useMemo(() => gpus.find(g => (g.uuid ?? String(g.id)) === selectedMainId), [gpus, selectedMainId]);
  const seriesMain = selectedMainId ? (history[selectedMainId] ?? []) : [];

  const visibleGpuCount = useMemo(() => {
    if (hosts.length > 0 && !demo) {
      return Object.values(hostGpuCounts).reduce((s, v) => s + v, 0);
    }
    return gpus.length;
  }, [hosts, demo, hostGpuCounts, gpus]);
  const avgUtil = useMemo(() => {
    if (hosts.length > 0 && !demo) {
      const totalUtil = Object.values(hostUtilSums).reduce((s, v) => s + v, 0);
      const count = Object.values(hostGpuCounts).reduce((s, v) => s + v, 0);
      return count ? Math.round(totalUtil / count) : 0;
    }
    const count = gpus.length;
    return count ? Math.round(gpus.reduce((s, g) => s + (g.utilization || 0), 0) / count) : 0;
  }, [hosts, demo, hostUtilSums, hostGpuCounts, gpus]);
  const avgTemp = useMemo(() => {
    if (hosts.length > 0 && !demo) {
      const totalTemp = Object.values(hostTempSums).reduce((s, v) => s + v, 0);
      const count = Object.values(hostGpuCounts).reduce((s, v) => s + v, 0);
      return count ? Math.round(totalTemp / count) : 0;
    }
    const count = gpus.length;
    return count ? Math.round(gpus.reduce((s, g) => s + (g.temperature || 0), 0) / count) : 0;
  }, [hosts, demo, hostTempSums, hostGpuCounts, gpus]);

  const pageTitle = "Accelera - GPU Acceleration Platform";
  const description = "Professional GPU acceleration platform with AI workload management and real-time monitoring.";

  return (
    <div className="min-h-screen app-bg">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={typeof window !== 'undefined' ? window.location.href : '/'} />
      </Helmet>
      <header id="top" className="border-b border-border/40 backdrop-blur-xl bg-background/80">
        <div className="container py-8 animate-fade-in relative">
          {/* Floating particles background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="animate-float absolute top-4 left-1/4 w-2 h-2 bg-accent-gpu/30 rounded-full" style={{animationDelay: '0s'}} />
            <div className="animate-float absolute top-8 right-1/3 w-1 h-1 bg-brand/40 rounded-full" style={{animationDelay: '2s'}} />
            <div className="animate-float absolute bottom-4 left-1/2 w-1.5 h-1.5 bg-brand-2/30 rounded-full" style={{animationDelay: '4s'}} />
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-4 mb-2">
              <img 
                src="/logo.png" 
                alt="Accelera" 
                className="h-16 w-auto"
              />
              <div className="flex items-center gap-3">
                <div className="status-indicator active" />
                <h1 className="text-4xl md:text-5xl font-bold tracking-tight bg-gradient-to-r from-brand via-accent-gpu to-brand-2 bg-clip-text text-transparent animate-gradient-shift">
                  Accelera
                </h1>
              </div>
            </div>
            <p className="text-muted-foreground mt-2 max-w-3xl text-lg leading-relaxed">
              High-Performance GPU Acceleration Platform with AI workload management and advanced analytics
            </p>
            
            {/* Status indicators */}
            <div className="flex items-center gap-4 mt-4">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${isFetching ? 'bg-accent-gpu animate-glow-pulse' : data ? 'bg-accent-gpu' : 'bg-muted'}`} />
                <span className="text-muted-foreground">
                  {isFetching ? 'Updating...' : data ? 'Connected' : 'Disconnected'}
                </span>
              </div>
              {data?.host && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Host:</span>
                  <span className="font-mono text-foreground">{data.host}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container py-6 space-y-6">
        <section id="controls" aria-label="Controls" className="performance-card animate-slide-up">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-1 w-1 rounded-full bg-accent-gpu animate-glow-pulse" />
              <h2 className="text-lg font-semibold">Configuration</h2>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 items-end">
            <div className="space-y-2">
              <Label htmlFor="api-url">API URL (JSON)</Label>
              <Input id="api-url" placeholder="https://your-host:port/nvidia-smi.json" value={inputUrl} onChange={(e) => setInputUrl(e.target.value)} />
            </div>
            <div className="flex items-center gap-3 md:justify-center">
              <Switch id="demo" checked={demo} onCheckedChange={handleDemoToggle} />
              <Label htmlFor="demo">Use demo data</Label>
            </div>
            <div className="space-y-2">
              <Label>Refresh</Label>
              <Select value={String(intervalMs)} onValueChange={handleInterval}>
                <SelectTrigger>
                  <SelectValue placeholder="Refresh interval" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Manual</SelectItem>
                  <SelectItem value="2000">2s</SelectItem>
                  <SelectItem value="3000">3s</SelectItem>
                  <SelectItem value="5000">5s</SelectItem>
                  <SelectItem value="10000">10s</SelectItem>
                  <SelectItem value="30000">30s</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Electricity rate ($/kWh)</Label>
              <Input
                type="number"
                step="0.001"
                inputMode="decimal"
                placeholder="0.20"
                value={energyRate ? String(energyRate) : ""}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  const rate = isNaN(v) ? 0 : v;
                  setEnergyRate(rate);
                  localStorage.setItem("nvidia_energy_rate", String(rate));
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>History window</Label>
              <Select value={String(historyMinutes)} onValueChange={(v) => {
                const m = Number(v);
                setHistoryMinutes(m);
                localStorage.setItem("nvidia_history_minutes", String(m));
              }}>
                <SelectTrigger>
                  <SelectValue placeholder="History window" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10 min</SelectItem>
                  <SelectItem value="30">30 min</SelectItem>
                  <SelectItem value="60">1 hour</SelectItem>
                  <SelectItem value="360">6 hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button className="w-full gpu-glow" onClick={handleAddHost}>Add host</Button>
              <Button variant="secondary" className="w-full" onClick={() => window.location.reload()} disabled={isFetching}>
                {isFetching ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
            </div>
          </div>
        </section>

        {/* KPI Section */}
        <section id="metrics" aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-slide-up" style={{animationDelay: '0.1s'}}>
          <Card className="neo-card group hover-lift">
            <CardContent className="p-6 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Active GPUs</div>
                  <div className="text-3xl font-bold tabular-nums bg-gradient-to-r from-accent-gpu to-brand bg-clip-text text-transparent">
                    {visibleGpuCount}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {visibleGpuCount === 1 ? 'device' : 'devices'} detected
                  </div>
                </div>
                <div className="relative">
                  <div className="rounded-full p-3 bg-gradient-to-br from-accent-gpu/20 to-brand/20 group-hover:from-accent-gpu/30 group-hover:to-brand/30 transition-all duration-300">
                    <Gauge className="h-6 w-6 text-accent-gpu" />
                  </div>
                  {visibleGpuCount > 0 && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-accent-gpu rounded-full animate-glow-pulse" />
                  )}
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-accent-gpu/20 to-transparent" />
            </CardContent>
          </Card>

          <Card className="neo-card group hover-lift">
            <CardContent className="p-6 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Avg Utilization</div>
                  <div className="text-3xl font-bold tabular-nums bg-gradient-to-r from-accent-perf to-brand-2 bg-clip-text text-transparent">
                    {avgUtil}%
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {avgUtil > 80 ? 'High load' : avgUtil > 50 ? 'Moderate load' : 'Low load'}
                  </div>
                </div>
                <div className="relative">
                  <div className="rounded-full p-3 bg-gradient-to-br from-accent-perf/20 to-brand-2/20 group-hover:from-accent-perf/30 group-hover:to-brand-2/30 transition-all duration-300">
                    <Activity className="h-6 w-6 text-accent-perf" />
                  </div>
                </div>
              </div>
              <div className="absolute bottom-0 left-0 h-1 bg-accent-perf/30 transition-all duration-500" style={{width: `${avgUtil}%`}} />
            </CardContent>
          </Card>

          <Card className="neo-card group hover-lift">
            <CardContent className="p-6 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Total Power</div>
                  <div className="text-3xl font-bold tabular-nums bg-gradient-to-r from-brand to-accent-gpu bg-clip-text text-transparent">
                    {Math.round(totalWattsAll)}W
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {costHrAll > 0 && `$${costHrAll.toFixed(2)}/hr`}
                  </div>
                </div>
                <div className="relative">
                  <div className="rounded-full p-3 bg-gradient-to-br from-brand/20 to-accent-gpu/20 group-hover:from-brand/30 group-hover:to-accent-gpu/30 transition-all duration-300">
                    <Zap className="h-6 w-6 text-brand" />
                  </div>
                  {totalWattsAll > 100 && (
                    <div className="absolute inset-0 rounded-full animate-glow-pulse bg-gradient-to-r from-brand/20 to-accent-gpu/20" />
                  )}
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-brand/30 to-accent-gpu/30 data-stream" />
            </CardContent>
          </Card>

          <Card className="neo-card group hover-lift">
            <CardContent className="p-6 relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Avg Temperature</div>
                  <div className={`text-3xl font-bold tabular-nums bg-gradient-to-r ${
                    avgTemp > 80 ? 'from-accent-critical to-accent-perf' : 
                    avgTemp > 70 ? 'from-accent-perf to-brand-2' : 
                    'from-brand to-accent-gpu'
                  } bg-clip-text text-transparent`}>
                    {avgTemp}°C
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {avgTemp > 80 ? 'High temp' : avgTemp > 70 ? 'Warm' : 'Optimal'}
                  </div>
                </div>
                <div className="relative">
                  <div className={`rounded-full p-3 bg-gradient-to-br transition-all duration-300 ${
                    avgTemp > 80 ? 'from-accent-critical/20 to-accent-perf/20 group-hover:from-accent-critical/30 group-hover:to-accent-perf/30' :
                    avgTemp > 70 ? 'from-accent-perf/20 to-brand-2/20 group-hover:from-accent-perf/30 group-hover:to-brand-2/30' :
                    'from-brand/20 to-accent-gpu/20 group-hover:from-brand/30 group-hover:to-accent-gpu/30'
                  }`}>
                    <Thermometer className={`h-6 w-6 ${
                      avgTemp > 80 ? 'text-accent-critical' : 
                      avgTemp > 70 ? 'text-accent-perf' : 
                      'text-brand'
                    }`} />
                  </div>
                  {avgTemp > 80 && (
                    <div className="absolute inset-0 rounded-full animate-glow-pulse bg-accent-critical/20" />
                  )}
                </div>
              </div>
              <div className={`absolute bottom-0 left-0 h-1 transition-all duration-500 ${
                avgTemp > 80 ? 'bg-accent-critical/40' : 
                avgTemp > 70 ? 'bg-accent-perf/40' : 
                'bg-brand/40'
              }`} style={{width: `${Math.min(100, (avgTemp / 100) * 100)}%`}} />
            </CardContent>
          </Card>
        </section>

        {hosts.length > 0 && (
          <section aria-label="Hosts List" className="container">
            <div className="text-sm text-muted-foreground mb-2">Hosts</div>
            <div className="flex flex-wrap gap-2">
              {hosts.map((h) => (
                <div key={h} className="flex items-center gap-2 rounded-md border px-2 py-1">
                  <a href={h} className="text-sm underline underline-offset-2" target="_blank" rel="noreferrer">{h}</a>
                  <Button size="sm" variant="secondary" onClick={() => handleRemoveHost(h)}>Remove</Button>
                </div>
              ))}
            </div>
          </section>
        )}

        <Separator />

        <section id="gpu-grid" aria-label="GPU Grid" className="pb-10 space-y-8">
          {energyRate > 0 && (
            <Card className="performance-card animate-slide-up relative overflow-hidden" style={{animationDelay: '0.2s'}}>
              <div className="absolute inset-0 bg-gradient-to-r from-accent-perf/5 via-transparent to-brand-2/5" />
              <CardHeader className="py-4 relative">
                <div className="flex items-center gap-2">
                  <div className="h-1 w-1 rounded-full bg-accent-perf animate-glow-pulse" />
                  <CardTitle className="text-lg font-semibold bg-gradient-to-r from-accent-perf to-brand-2 bg-clip-text text-transparent">
                    Energy Analytics
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0 relative">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="neo-card p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Current Draw</div>
                    <div className="text-2xl font-bold font-mono text-accent-perf">{Math.round(totalWattsAll)}W</div>
                  </div>
                  <div className="neo-card p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">Cost per Hour</div>
                    <div className="text-2xl font-bold font-mono text-brand">${costHrAll.toFixed(2)}</div>
                  </div>
                  <div className="neo-card p-4 text-center">
                    <div className="text-xs text-muted-foreground mb-1">24h Consumption</div>
                    <div className="text-lg font-bold font-mono text-brand-2">{totalKwh24All.toFixed(2)} kWh</div>
                    <div className="text-sm font-mono text-accent-perf">${cost24hAll.toFixed(2)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {hosts.length > 0 && !demo ? (
            hosts.map((host) => (
              <HostSection
                key={host}
                host={host}
                onUpdate={(w) => setHostWatts((prev) => ({ ...prev, [host]: w }))}
                onUpdateKwh={(k) => setHostKwh24((prev) => ({ ...prev, [host]: k }))}
                onUpdateStats={(s) => {
                  setHostGpuCounts((prev) => ({ ...prev, [host]: s.gpuCount }));
                  setHostUtilSums((prev) => ({ ...prev, [host]: s.utilSum }));
                  setHostTempSums((prev) => ({ ...prev, [host]: s.tempSum }));
                }}
              />
            ))
          ) : gpus.length === 0 ? (
            <div className="neo-card p-12 text-center animate-fade-in">
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-muted/20 to-muted/40 flex items-center justify-center">
                  <Gauge className="h-8 w-8 text-muted-foreground" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">No GPU Data Available</h3>
                  <p className="text-muted-foreground">
                    {demo ? 'Enable demo mode to see sample data' : 'Check your API connection and ensure NVIDIA drivers are installed'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-4 animate-fade-in">
              <div className="lg:col-span-3">
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
                  {gpus.map((gpu, index) => {
                    const id = gpu.uuid ?? String(gpu.id);
                    return (
                      <div 
                        key={id} 
                        className="animate-slide-up" 
                        style={{animationDelay: `${0.1 * index}s`}}
                      >
                        <GpuCard 
                          info={gpu} 
                          energyRate={energyRate} 
                          onSelect={() => setSelectedMainId(id)} 
                          selected={selectedMainId === id} 
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="animate-slide-up" style={{animationDelay: '0.3s'}}>
                <GpuHistoryPanel 
                  title={selectedGpuMain ? `${selectedGpuMain.name} • GPU ${selectedGpuMain.id} History` : "GPU History"} 
                  series={seriesMain} 
                />
              </div>
            </div>
          )}
        </section>
      </main>
      <footer className="border-t border-border/40 bg-background/50 backdrop-blur-xl">
        <div className="container py-6 text-sm text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="status-indicator active" />
            <span className="font-mono">{data?.host ?? "Local Host"}</span>
          </div>
          <div className="flex items-center gap-4">
            {data?.timestamp && (
              <span className="font-mono">
                Last update: {new Date(data.timestamp).toLocaleTimeString()}
              </span>
            )}
            <span className="text-xs opacity-70">
              Accelera v2.0
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
