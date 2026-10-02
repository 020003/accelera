import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Boxes,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  Layers3,
  Server,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { LLMStatus } from "@/hooks/useTokenStats";
import type { HostData, RuntimeModel } from "@/types/dashboard";

interface VllmOperationsPanelProps {
  status?: LLMStatus;
  discovery: NonNullable<HostData["vllm"]>;
}

interface HistoryPoint {
  time: string;
  running: number;
  waiting: number;
  throughput: number;
  cache: number;
}

interface InstanceStatus {
  endpoint: string;
  scheduler: LLMStatus["scheduler"];
  cache: LLMStatus["cache"];
  prefix_cache: LLMStatus["prefix_cache"];
  counters: LLMStatus["counters"];
  preemptions: number;
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function modelName(model: RuntimeModel): string {
  return model.id || model.name || "Unknown model";
}

function endpointLabel(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.hostname}:${url.port || "80"}`;
  } catch {
    return endpoint;
  }
}

export function VllmOperationsPanel({ status, discovery }: VllmOperationsPanelProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  useEffect(() => {
    if (!status?.available) return;
    const point = {
      time: new Date(status.collected_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      running: status.scheduler.running,
      waiting: status.scheduler.waiting,
      throughput: status.throughput.total_tokens_per_second,
      cache: status.cache.gpu_usage_pct,
    };
    setHistory((current) => [...current.filter((item) => item.time !== point.time), point].slice(-60));
  }, [status]);

  const instances = (status?.instances || []) as InstanceStatus[];
  const activeRequests = (status?.scheduler.running || 0) + (status?.scheduler.waiting || 0);
  const queuePressure = activeRequests > 0 ? ((status?.scheduler.waiting || 0) / activeRequests) * 100 : 0;
  const health = useMemo(() => {
    if (!status?.available) return { label: "Metrics unavailable", tone: "text-muted-foreground", badge: "secondary" as const };
    if (status.cache.gpu_usage_pct >= 95 || queuePressure >= 50) return { label: "Congested", tone: "text-red-500", badge: "destructive" as const };
    if (status.cache.gpu_usage_pct >= 85 || status.scheduler.waiting > 0) return { label: "Under load", tone: "text-amber-500", badge: "secondary" as const };
    return { label: "Healthy", tone: "text-emerald-500", badge: "outline" as const };
  }, [queuePressure, status]);

  if (!status?.available) {
    return (
      <Card className="surface-panel">
        <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
          <Gauge className="mb-3 h-9 w-9 text-muted-foreground/50" />
          <h3 className="font-semibold">Waiting for vLLM metrics</h3>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            The model server was discovered, but its Prometheus metrics endpoint is not currently reachable.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="surface-panel overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-orange-500 via-amber-400 to-emerald-400" />
        <CardHeader className="flex-row items-start justify-between space-y-0 pb-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant={health.badge}>{health.label}</Badge>
              <Badge variant="outline">vLLM {discovery.version || "runtime"}</Badge>
              <Badge variant="outline">{instances.length || discovery.vllmUrls?.length || 1} instance{(instances.length || discovery.vllmUrls?.length || 1) === 1 ? "" : "s"}</Badge>
            </div>
            <CardTitle className="text-xl">Inference operations</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Live scheduler demand, cache pressure, and serving throughput.</p>
          </div>
          <div className={`rounded-xl bg-muted/40 p-3 ${health.tone}`}>
            <Activity className="h-6 w-6" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
            <OperationMetric icon={Zap} label="Processing" value={status.scheduler.running.toString()} detail="in execution" tone="text-emerald-500" />
            <OperationMetric icon={Clock3} label="Waiting" value={status.scheduler.waiting.toString()} detail={`${queuePressure.toFixed(0)}% queue pressure`} tone={status.scheduler.waiting ? "text-amber-500" : "text-muted-foreground"} />
            <OperationMetric icon={Layers3} label="Swapped" value={status.scheduler.swapped.toString()} detail="requests" tone={status.scheduler.swapped ? "text-red-500" : "text-muted-foreground"} />
            <OperationMetric icon={Gauge} label="Output rate" value={`${status.throughput.generation_tokens_per_second.toFixed(1)}`} detail="tokens / second" tone="text-blue-500" />
            <OperationMetric icon={Activity} label="Total rate" value={`${status.throughput.total_tokens_per_second.toFixed(1)}`} detail="input + output" tone="text-cyan-500" />
            <OperationMetric icon={Boxes} label="KV cache" value={`${status.cache.gpu_usage_pct.toFixed(1)}%`} detail="peak GPU usage" tone={status.cache.gpu_usage_pct >= 90 ? "text-red-500" : "text-purple-500"} />
            <OperationMetric icon={CheckCircle2} label="Prefix hits" value={`${status.prefix_cache.hit_rate_pct.toFixed(1)}%`} detail={`${formatNumber(status.prefix_cache.hits)} cached tokens`} tone="text-emerald-500" />
            <OperationMetric icon={TriangleAlert} label="Preemptions" value={formatNumber(status.preemptions)} detail={`${formatNumber(status.counters.successful_requests)} completed`} tone={status.preemptions ? "text-amber-500" : "text-muted-foreground"} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <Card className="surface-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-blue-500" />
              Live scheduler timeline
              <span className="font-normal text-muted-foreground">last {history.length} samples</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="vllmRunning" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-green)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-green)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="vllmWaiting" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-amber)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-amber)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} opacity={0.45} />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={28} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 10, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="running" name="Processing" stroke="var(--chart-green)" fill="url(#vllmRunning)" strokeWidth={2} />
                  <Area type="monotone" dataKey="waiting" name="Waiting" stroke="var(--chart-amber)" fill="url(#vllmWaiting)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <PressureBar label="Queue pressure" value={queuePressure} warning={35} critical={60} />
              <PressureBar label="GPU KV-cache pressure" value={status.cache.gpu_usage_pct} warning={80} critical={95} />
            </div>
          </CardContent>
        </Card>

        <Card className="surface-panel">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Server className="h-4 w-4 text-orange-500" />
              Serving instances
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(instances.length ? instances : (discovery.vllmUrls || [discovery.vllmUrl]).filter(Boolean).map((endpoint) => ({ endpoint }))).map((instance, index) => {
              const detailed = "scheduler" in instance ? instance as InstanceStatus : undefined;
              return (
                <div key={instance.endpoint || index} className="rounded-xl border border-border/60 bg-background/45 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{endpointLabel(instance.endpoint || "unknown")}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{instance.endpoint}</div>
                    </div>
                    <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-500">online</Badge>
                  </div>
                  {detailed && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <InstanceMetric label="run" value={detailed.scheduler.running} />
                      <InstanceMetric label="wait" value={detailed.scheduler.waiting} />
                      <InstanceMetric label="cache" value={`${detailed.cache.gpu_usage_pct.toFixed(0)}%`} />
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="surface-panel">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cpu className="h-4 w-4 text-orange-500" />
            Served models
            <Badge variant="secondary" className="ml-auto">{discovery.models.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {discovery.models.map((model) => (
              <div key={modelName(model)} className="rounded-xl border border-border/60 bg-background/45 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-orange-500/10 p-2 text-orange-500"><Zap className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold" title={modelName(model)}>{modelName(model)}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {typeof model.max_model_len === "number" && model.max_model_len > 0 ? `${formatNumber(model.max_model_len)} token context` : "OpenAI-compatible endpoint"}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OperationMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof Activity; label: string; value: string; detail: string; tone: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/45 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"><Icon className={`h-3.5 w-3.5 ${tone}`} />{label}</div>
      <div className={`mt-2 font-mono text-xl font-bold leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] text-muted-foreground">{detail}</div>
    </div>
  );
}

function PressureBar({ label, value, warning, critical }: { label: string; value: number; warning: number; critical: number }) {
  const tone = value >= critical ? "text-red-500" : value >= warning ? "text-amber-500" : "text-emerald-500";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11px]"><span className="text-muted-foreground">{label}</span><span className={`font-mono font-semibold ${tone}`}>{value.toFixed(1)}%</span></div>
      <Progress value={Math.min(value, 100)} className="h-1.5" />
    </div>
  );
}

function InstanceMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md bg-muted/40 px-2 py-1.5"><div className="font-mono text-xs font-semibold">{value}</div><div className="text-[9px] uppercase text-muted-foreground">{label}</div></div>;
}
