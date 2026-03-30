import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  MessageSquare,
  Zap,
  Clock,
  Hash,
  TrendingUp,
  Bot,
} from "lucide-react";
import type { TokenStats } from "@/hooks/useTokenStats";

interface TokenStatsCardProps {
  stats: TokenStats;
  isLoading?: boolean;
  hours?: number;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

export function TokenStatsCard({ stats, isLoading, hours = 24 }: TokenStatsCardProps) {
  const windowLabel = hours <= 24 ? `${hours}h` : `${hours / 24}d`;
  const { summary, models, history } = stats;
  const modelNames = Object.keys(models);

  const cumTokens = summary.cumulative_tokens ?? 0;
  const cumGen = summary.cumulative_generated ?? 0;
  const cumPt = summary.cumulative_prompt ?? 0;
  const cumReq = summary.cumulative_requests ?? 0;
  const hasWindowActivity = summary.total_tokens > 0;

  const kpis = [
    {
      label: "All-time Tokens",
      value: formatNumber(cumTokens),
      sub: `${formatNumber(cumPt)} prompt · ${formatNumber(cumGen)} generated`,
      icon: Hash,
      color: "text-blue-500",
      bg: "bg-blue-500/10",
    },
    {
      label: "Current Rate",
      value: summary.current_tps > 0 ? `${summary.current_tps}` : "—",
      sub: "tokens / sec",
      icon: Zap,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
    },
    {
      label: hasWindowActivity ? "Requests (window)" : "All-time Requests",
      value: formatNumber(hasWindowActivity ? summary.total_requests : cumReq),
      sub: hasWindowActivity && summary.total_duration_sec > 0
        ? `${formatDuration(summary.total_duration_sec)} total inference`
        : hasWindowActivity
        ? "in selected window"
        : "since tracking started",
      icon: MessageSquare,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
    },
    {
      label: "Models Tracked",
      value: modelNames.length.toString(),
      sub: modelNames.slice(0, 2).join(", ") + (modelNames.length > 2 ? ` +${modelNames.length - 2}` : ""),
      icon: Bot,
      color: "text-purple-500",
      bg: "bg-purple-500/10",
    },
  ];

  // Prepare chart data — downsample to ~120 points for readability while keeping full range
  const maxPoints = 120;
  const step = history.length > maxPoints ? Math.ceil(history.length / maxPoints) : 1;
  const chartData = history
    .filter((_, i) => i % step === 0 || i === history.length - 1)
    .map((pt) => ({
      time: new Date(pt.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      generated: pt.generated,
      prompt: pt.prompt,
      total: pt.total,
    }));

  const hasActivity = summary.total_tokens > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Token Usage
            <span className="text-xs font-normal text-muted-foreground">{windowLabel}</span>
          </div>
          {hasActivity && (
            <Badge variant="secondary" className="text-[10px] font-mono">
              {formatNumber(summary.total_tokens)} tokens
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.label}
                className="flex items-start gap-2.5 p-2.5 rounded-lg bg-muted/30"
              >
                <div className={`p-1.5 rounded-md ${kpi.bg} mt-0.5`}>
                  <Icon className={`h-3.5 w-3.5 ${kpi.color}`} />
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground leading-none mb-1">
                    {kpi.label}
                  </div>
                  <div className="text-lg font-bold font-mono leading-none">
                    {kpi.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                    {kpi.sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Chart */}
        {chartData.length > 1 && (
          <div className="h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="genGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-blue)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--chart-blue)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="promptGrad" x1="0" y1="0" x2="0" y2="1">
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
                  tickFormatter={formatNumber}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="generated"
                  name="Generated"
                  stroke="var(--chart-blue)"
                  fill="url(#genGrad)"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="prompt"
                  name="Prompt"
                  stroke="var(--chart-violet)"
                  fill="url(#promptGrad)"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Per-model breakdown */}
        {modelNames.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Per-model breakdown</div>
            <div className="divide-y divide-border/50">
              {modelNames.map((name) => {
                const m = models[name];
                const cumTotal = (m.cumulative_generated ?? 0) + (m.cumulative_prompt ?? 0);
                const windowTotal = m.generated_tokens + m.prompt_tokens;
                return (
                  <div key={name} className="flex items-center justify-between py-1.5 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                      <span className="font-mono">{formatNumber(cumTotal)} tok</span>
                      {windowTotal > 0 && (
                        <span className="font-mono text-blue-400">+{formatNumber(windowTotal)}</span>
                      )}
                      <span className="font-mono">{m.cumulative_requests ?? m.requests} req</span>
                      {m.avg_tokens_per_sec > 0 && (
                        <span className="font-mono text-amber-500">{m.avg_tokens_per_sec} t/s</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!hasActivity && !isLoading && (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No token activity recorded yet</p>
            <p className="text-xs mt-1">Statistics populate as Ollama processes requests</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
