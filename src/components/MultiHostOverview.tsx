import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts";
import {
  Server,
  Cpu,
  Activity,
  HardDrive,
  Thermometer,
  Zap,
  Bot,
  Hash,
  TrendingUp,
  MessageSquare,
  DollarSign,
  CheckCircle,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { useFleetTokenStats } from "@/hooks/useFleetTokenStats";
import type { GpuInfo } from "@/types/gpu";

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
  sglang?: {
    isAvailable: boolean;
    models: any[];
    sglangUrl?: string;
    serverInfo?: any;
  };
}

interface MultiHostOverviewProps {
  hostsData: HostData[];
  energyRate: number;
  currencySymbol?: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function fmtDur(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

const TIME_RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "3d", hours: 72 },
  { label: "7d", hours: 168 },
] as const;

export function MultiHostOverview({ hostsData, energyRate, currencySymbol = "$" }: MultiHostOverviewProps) {
  const [hours, setHours] = useState(24);
  const connectedHosts = hostsData.filter((h) => h.isConnected);
  const allGpus = connectedHosts.flatMap((h) => h.gpus);
  const totalGpus = allGpus.length;

  const avgUtil =
    totalGpus > 0
      ? Math.round(allGpus.reduce((s, g) => s + g.utilization, 0) / totalGpus)
      : 0;
  const avgTemp =
    totalGpus > 0
      ? Math.round(allGpus.reduce((s, g) => s + g.temperature, 0) / totalGpus)
      : 0;
  const totalPower = allGpus.reduce((s, g) => s + g.power.draw, 0);
  const memUsed = allGpus.reduce((s, g) => s + g.memory.used, 0);
  const memTotal = allGpus.reduce((s, g) => s + g.memory.total, 0);
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

  const hourlyCost = energyRate > 0 ? (totalPower / 1000) * energyRate : 0;
  const dailyCost = hourlyCost * 24;

  const totalModels = hostsData.reduce(
    (s, h) => s + (h.ollama?.models.length || 0) + (h.sglang?.models.length || 0),
    0
  );
  const hostsWithOllama = hostsData.filter((h) => h.ollama?.isAvailable).length;
  const hostsWithSglang = hostsData.filter((h) => h.sglang?.isAvailable).length;

  // Fleet-wide token stats
  const hostUrls = hostsData.map((h) => h.url);
  const { data: fleet } = useFleetTokenStats(hostUrls, hours);

  // Per-host utilization bar chart data
  const hostBarData = connectedHosts.map((h) => {
    const gpus = h.gpus;
    const util =
      gpus.length > 0
        ? Math.round(gpus.reduce((s, g) => s + g.utilization, 0) / gpus.length)
        : 0;
    return { name: h.name, util, gpus: gpus.length };
  });

  // Token history for fleet chart — downsample to ~120 pts, keep full range
  const rawHistory = fleet?.history ?? [];
  const maxPts = 120;
  const step = rawHistory.length > maxPts ? Math.ceil(rawHistory.length / maxPts) : 1;

  const fmtTime = (iso: string): string => {
    const d = new Date(iso);
    if (hours <= 12) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    if (hours <= 24) {
      return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const chartData = rawHistory
    .filter((_, i) => i % step === 0 || i === rawHistory.length - 1)
    .map((pt) => ({
      time: fmtTime(pt.time),
      tokens: pt.total,
      generated: pt.generated,
      prompt: pt.prompt,
    }));

  const rangeLabel = TIME_RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`;

  return (
    <div className="space-y-5">
      {/* ─── Time range picker ─── */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">Fleet Overview</h2>
        <ToggleGroup
          type="single"
          value={String(hours)}
          onValueChange={(v) => v && setHours(Number(v))}
          className="h-7"
        >
          {TIME_RANGES.map((r) => (
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

      {/* ─── Hero KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          {
            label: "Hosts Online",
            value: `${connectedHosts.length}/${hostsData.length}`,
            icon: Server,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Total GPUs",
            value: totalGpus,
            icon: Cpu,
            color: "text-emerald-500",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Fleet Utilization",
            value: `${avgUtil}%`,
            icon: Activity,
            color: avgUtil >= 80 ? "text-amber-500" : "text-blue-500",
            bg: avgUtil >= 80 ? "bg-amber-500/10" : "bg-blue-500/10",
          },
          {
            label: "VRAM",
            value: `${memPct}%`,
            icon: HardDrive,
            color: memPct >= 80 ? "text-red-500" : "text-purple-500",
            bg: memPct >= 80 ? "bg-red-500/10" : "bg-purple-500/10",
            sub: `${Math.round(memUsed / 1024)}/${Math.round(memTotal / 1024)} GB`,
          },
          {
            label: "Avg Temp",
            value: `${avgTemp}°C`,
            icon: Thermometer,
            color:
              avgTemp >= 80
                ? "text-red-500"
                : avgTemp >= 70
                ? "text-amber-500"
                : "text-emerald-500",
            bg:
              avgTemp >= 80
                ? "bg-red-500/10"
                : avgTemp >= 70
                ? "bg-amber-500/10"
                : "bg-emerald-500/10",
          },
          {
            label: "Power Draw",
            value: `${Math.round(totalPower)}W`,
            icon: Zap,
            color: "text-amber-500",
            bg: "bg-amber-500/10",
            sub:
              energyRate > 0
                ? `${currencySymbol}${hourlyCost.toFixed(2)}/hr`
                : undefined,
          },
          {
            label: `${rangeLabel} Tokens`,
            value: fmt(fleet?.summary.total_tokens ?? 0),
            icon: Hash,
            color: "text-blue-500",
            bg: "bg-blue-500/10",
            sub:
              (fleet?.summary.current_tps ?? 0) > 0
                ? `${fleet!.summary.current_tps} tok/s now`
                : `${rangeLabel} window`,
          },
          {
            label: "AI Models",
            value: totalModels,
            icon: Bot,
            color: "text-purple-500",
            bg: "bg-purple-500/10",
            sub:
              hostsWithOllama > 0 || hostsWithSglang > 0
                ? [
                    hostsWithOllama > 0 ? `${hostsWithOllama} Ollama` : "",
                    hostsWithSglang > 0 ? `${hostsWithSglang} SGLang` : "",
                  ].filter(Boolean).join(" + ")
                : undefined,
          },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="shadow-none border-border/50">
              <CardContent className="p-3">
                <div className="flex items-start gap-2.5">
                  <div className={`p-1.5 rounded-md ${kpi.bg} mt-0.5`}>
                    <Icon className={`h-4 w-4 ${kpi.color}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground leading-none mb-0.5">
                      {kpi.label}
                    </div>
                    <div className="text-lg font-bold font-mono leading-tight">
                      {kpi.value}
                    </div>
                    {"sub" in kpi && kpi.sub && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {kpi.sub}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ─── Charts row ─── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Fleet Token Throughput */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Fleet Token Throughput
              <span className="text-xs font-normal text-muted-foreground">{rangeLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 1 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={chartData}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="fleetGenGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fleetPtGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--chart-violet)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--chart-violet)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={fmt}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="generated"
                      name="Generated"
                      stroke="var(--chart-blue)"
                      fill="url(#fleetGenGrad)"
                      strokeWidth={1.5}
                    />
                    <Area
                      type="monotone"
                      dataKey="prompt"
                      name="Prompt"
                      stroke="var(--chart-violet)"
                      fill="url(#fleetPtGrad)"
                      strokeWidth={1.5}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
                Collecting token data — chart populates over time
              </div>
            )}
          </CardContent>
        </Card>

        {/* Per-host GPU utilization bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              Host GPU Utilization
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hostBarData.length > 0 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={hostBarData}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [`${value}%`, "Utilization"]}
                    />
                    <Bar dataKey="util" radius={[4, 4, 0, 0]} maxBarSize={48}>
                      {hostBarData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={
                            entry.util >= 80
                              ? "var(--chart-orange)"
                              : entry.util >= 50
                              ? "var(--chart-blue)"
                              : "var(--chart-green)"
                          }
                          fillOpacity={0.75}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-44 flex items-center justify-center text-sm text-muted-foreground">
                No hosts connected
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Fleet AI & Cost Summary ─── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Token breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              AI Inference Summary
              <span className="text-xs font-normal text-muted-foreground">{rangeLabel}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-muted/30">
                <div className="text-[10px] text-muted-foreground">Prompt Tokens</div>
                <div className="text-lg font-bold font-mono">
                  {fmt(fleet?.summary.total_prompt ?? 0)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30">
                <div className="text-[10px] text-muted-foreground">Generated Tokens</div>
                <div className="text-lg font-bold font-mono">
                  {fmt(fleet?.summary.total_generated ?? 0)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30">
                <div className="text-[10px] text-muted-foreground">Total Requests</div>
                <div className="text-lg font-bold font-mono">
                  {fleet?.summary.total_requests ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-muted/30">
                <div className="text-[10px] text-muted-foreground">Inference Time</div>
                <div className="text-lg font-bold font-mono">
                  {fmtDur(fleet?.summary.total_duration_sec ?? 0)}
                </div>
              </div>
            </div>
            {Object.keys(fleet?.models ?? {}).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Top Models
                </div>
                <div className="divide-y divide-border/50">
                  {Object.entries(fleet?.models ?? {})
                    .sort(
                      ([, a], [, b]) =>
                        b.generated_tokens +
                        b.prompt_tokens -
                        (a.generated_tokens + a.prompt_tokens)
                    )
                    .slice(0, 4)
                    .map(([name, m]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between py-1.5 text-xs"
                      >
                        <span className="font-medium truncate max-w-[55%]">
                          {name}
                        </span>
                        <div className="flex items-center gap-2 text-muted-foreground shrink-0">
                          <span className="font-mono">
                            {fmt(m.generated_tokens + m.prompt_tokens)}
                          </span>
                          {m.avg_tokens_per_sec > 0 && (
                            <span className="font-mono text-amber-500">
                              {m.avg_tokens_per_sec} t/s
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Cost Estimator
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {energyRate > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <div className="text-[10px] text-muted-foreground">Hourly</div>
                    <div className="text-lg font-bold font-mono text-emerald-500">
                      {currencySymbol}{hourlyCost.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <div className="text-[10px] text-muted-foreground">Daily</div>
                    <div className="text-lg font-bold font-mono text-emerald-500">
                      {currencySymbol}{dailyCost.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <div className="text-[10px] text-muted-foreground">Monthly (est)</div>
                    <div className="text-lg font-bold font-mono text-emerald-500">
                      {currencySymbol}{(dailyCost * 30).toFixed(0)}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/30">
                    <div className="text-[10px] text-muted-foreground">{currencySymbol}/GPU/hr</div>
                    <div className="text-lg font-bold font-mono text-emerald-500">
                      {totalGpus > 0
                        ? `${currencySymbol}${(hourlyCost / totalGpus).toFixed(3)}`
                        : "—"}
                    </div>
                  </div>
                </div>
                {(fleet?.summary.total_tokens ?? 0) > 0 && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <div className="text-[10px] text-muted-foreground">
                      Cost per 1M tokens ({rangeLabel})
                    </div>
                    <div className="text-lg font-bold font-mono text-emerald-500">
                      {currencySymbol}
                      {(
                        (hourlyCost * hours) / (fleet!.summary.total_tokens / 1_000_000)
                      ).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Based on {fmt(fleet!.summary.total_tokens)} tokens in {rangeLabel} &
                      current power draw
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <DollarSign className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Set an energy rate in Settings to see cost estimates
              </div>
            )}
          </CardContent>
        </Card>

        {/* Host fleet cards */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              Host Fleet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {hostsData.map((host) => {
                const gpus = host.gpus;
                const util =
                  gpus.length > 0
                    ? Math.round(
                        gpus.reduce((s, g) => s + g.utilization, 0) / gpus.length
                      )
                    : 0;
                const power = Math.round(
                  gpus.reduce((s, g) => s + g.power.draw, 0)
                );
                const hostTokens = fleet?.perHost[host.url];
                return (
                  <div
                    key={host.url}
                    className="p-2.5 rounded-lg bg-muted/30 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            host.isConnected
                              ? "bg-emerald-500"
                              : "bg-red-500"
                          }`}
                        />
                        <span className="text-sm font-medium">{host.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {host.ollama?.isAvailable && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] h-4 px-1.5"
                          >
                            <Bot className="h-2.5 w-2.5 mr-0.5" />
                            {host.ollama.models.length}
                          </Badge>
                        )}
                        {host.sglang?.isAvailable && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] h-4 px-1.5 bg-cyan-500/10 text-cyan-400"
                          >
                            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                            {host.sglang.models.length}
                          </Badge>
                        )}
                        <Badge
                          variant={host.isConnected ? "default" : "secondary"}
                          className="text-[9px] h-4 px-1.5"
                        >
                          {host.isConnected ? "Online" : "Offline"}
                        </Badge>
                      </div>
                    </div>
                    {host.isConnected && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-mono">
                          {gpus.length} GPU{gpus.length !== 1 ? "s" : ""}
                        </span>
                        <span className="font-mono">{util}% util</span>
                        <span className="font-mono">{power}W</span>
                        {hostTokens && hostTokens.summary.total_tokens > 0 && (
                          <span className="font-mono text-blue-500">
                            {fmt(hostTokens.summary.total_tokens)} tok
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}