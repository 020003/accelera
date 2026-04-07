import { memo, useEffect, useState, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Activity,
  Gauge,
  Calendar,
  DollarSign,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { GpuInfo } from "@/types/gpu";

interface PowerDataPoint {
  timestamp: string;
  time: string;
  _total: number;
  [key: string]: number | string;
}

interface PowerUsageChartProps {
  hosts: Array<{
    url: string;
    name: string;
    isConnected: boolean;
  }>;
  hostData: Map<string, { gpus: GpuInfo[]; timestamp?: string }>;
  refreshInterval: number;
  energyRate?: number;
  currencySymbol?: string;
}

// Theme-aware palette that works in both light and dark modes
const CHART_COLORS = [
  "hsl(217, 91%, 60%)",  // Blue
  "hsl(142, 71%, 45%)",  // Green
  "hsl(25, 95%, 53%)",   // Orange
  "hsl(263, 70%, 50%)",  // Purple
  "hsl(0, 84%, 60%)",    // Red
  "hsl(47, 96%, 53%)",   // Yellow
  "hsl(199, 89%, 48%)",  // Sky
  "hsl(330, 81%, 60%)",  // Pink
];

const MAX_DATA_POINTS = 60;

type ChartMode = "stacked" | "line";

// ── Stat card used in the summary row ──
function StatMini({
  icon: Icon,
  label,
  value,
  sub,
  color = "text-muted-foreground",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`p-1.5 rounded-md bg-muted/60 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground leading-none truncate">{label}</div>
        <div className="text-sm font-bold font-mono leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground leading-none truncate">{sub}</div>}
      </div>
    </div>
  );
}

// ── Custom tooltip ──
function PowerTooltip({
  active,
  payload,
  label,
  energyRate,
  currencySymbol,
  powerLimit,
}: any) {
  if (!active || !payload?.length) return null;

  const total = payload.reduce(
    (s: number, p: any) => s + (typeof p.value === "number" ? p.value : 0),
    0
  );
  const pct = powerLimit > 0 ? ((total / powerLimit) * 100).toFixed(0) : null;
  const cost = energyRate > 0 ? (total / 1000) * energyRate : 0;

  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md text-xs space-y-1.5">
      <div className="font-medium text-[11px] text-muted-foreground">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: p.color }}
            />
            {p.name}
          </span>
          <span className="font-mono font-semibold">
            {Math.round(p.value)}W
          </span>
        </div>
      ))}
      <div className="border-t border-border pt-1.5 flex items-center justify-between gap-4 font-semibold">
        <span>Total</span>
        <span className="font-mono">
          {Math.round(total)}W
          {pct && (
            <span className="text-muted-foreground font-normal ml-1">
              ({pct}%)
            </span>
          )}
        </span>
      </div>
      {cost > 0 && (
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>Hourly cost</span>
          <span className="font-mono">
            {currencySymbol}{cost.toFixed(3)}
          </span>
        </div>
      )}
    </div>
  );
}

export const PowerUsageChart = memo(function PowerUsageChart({
  hosts,
  hostData,
  refreshInterval,
  energyRate = 0,
  currencySymbol = "$",
}: PowerUsageChartProps) {
  const [chartData, setChartData] = useState<PowerDataPoint[]>([]);
  const [totalPower, setTotalPower] = useState(0);
  const [powerLimit, setPowerLimit] = useState(0);
  const [peakPower, setPeakPower] = useState(0);
  const [trend, setTrend] = useState<"up" | "down" | "stable">("stable");
  const [mode, setMode] = useState<ChartMode>("stacked");
  const lastUpdateRef = useRef<number>(0);

  // Connected host keys for the chart series
  const connectedHosts = useMemo(
    () => hosts.filter((h) => h.isConnected),
    [hosts]
  );

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 2000) return;
    lastUpdateRef.current = now;
    if (refreshInterval < 3000) return;

    const newPoint: PowerDataPoint = {
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      _total: 0,
    };

    let currentTotal = 0;
    let currentLimit = 0;

    hosts.forEach((host) => {
      if (host.isConnected && hostData.has(host.url)) {
        const data = hostData.get(host.url);
        if (data?.gpus) {
          const hostPower = data.gpus.reduce(
            (sum: number, gpu: GpuInfo) => sum + (gpu.power?.draw || 0),
            0
          );
          const hostLimit = data.gpus.reduce(
            (sum: number, gpu: GpuInfo) => sum + (gpu.power?.limit || 0),
            0
          );
          newPoint[host.name || host.url] = Math.round(hostPower);
          currentTotal += hostPower;
          currentLimit += hostLimit;
        }
      }
    });

    newPoint._total = Math.round(currentTotal);
    setTotalPower(Math.round(currentTotal));
    setPowerLimit(Math.round(currentLimit));

    setChartData((prev) => {
      const updated = [...prev, newPoint].slice(-MAX_DATA_POINTS);

      // Peak
      const peak = Math.max(...updated.map((p) => p._total));
      setPeakPower(peak);

      // Trend (compare last two)
      if (updated.length > 1) {
        const prevTotal = updated[updated.length - 2]._total;
        if (currentTotal > prevTotal * 1.05) setTrend("up");
        else if (currentTotal < prevTotal * 0.95) setTrend("down");
        else setTrend("stable");
      }

      return updated;
    });
  }, [hosts, hostData, refreshInterval]);

  // Derived stats
  const avgPower = useMemo(() => {
    if (chartData.length === 0) return 0;
    return Math.round(
      chartData.reduce((s, p) => s + p._total, 0) / chartData.length
    );
  }, [chartData]);

  const totalGpus = useMemo(() => {
    let count = 0;
    hosts.forEach((h) => {
      if (h.isConnected && hostData.has(h.url)) {
        count += hostData.get(h.url)?.gpus?.length || 0;
      }
    });
    return count;
  }, [hosts, hostData]);

  const capPct =
    powerLimit > 0 ? ((totalPower / powerLimit) * 100).toFixed(0) : null;
  const hourlyCost = energyRate > 0 ? (totalPower / 1000) * energyRate : 0;
  const dailyCost = hourlyCost * 24;
  const monthlyCost = dailyCost * 30;

  return (
    <Card className="col-span-full">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-amber-500" />
            <CardTitle className="text-base">Power Usage Timeline</CardTitle>
          </div>
          <div className="flex items-center gap-3">
            {/* Chart mode toggle */}
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as ChartMode)}
              size="sm"
              className="bg-muted/50 rounded-md p-0.5"
            >
              <ToggleGroupItem value="stacked" className="h-7 px-2 text-xs gap-1 cursor-pointer data-[state=on]:bg-background">
                <BarChart3 className="h-3 w-3" />
                Stacked
              </ToggleGroupItem>
              <ToggleGroupItem value="line" className="h-7 px-2 text-xs gap-1 cursor-pointer data-[state=on]:bg-background">
                <Activity className="h-3 w-3" />
                Line
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Live total */}
            <div className="flex items-center gap-1.5">
              {trend === "up" && <TrendingUp className="h-4 w-4 text-red-500" />}
              {trend === "down" && <TrendingDown className="h-4 w-4 text-emerald-500" />}
              {trend === "stable" && <Minus className="h-4 w-4 text-muted-foreground" />}
              <span className="text-xl font-bold font-mono">{totalPower}W</span>
            </div>
            {capPct && (
              <Badge
                variant="outline"
                className={`text-xs font-mono ${
                  Number(capPct) > 90
                    ? "border-red-500/50 text-red-500"
                    : Number(capPct) > 75
                    ? "border-amber-500/50 text-amber-500"
                    : "border-emerald-500/50 text-emerald-500"
                }`}
              >
                {capPct}% cap
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Summary stats row ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <StatMini
            icon={Zap}
            label="Total Draw"
            value={`${totalPower}W`}
            sub={powerLimit > 0 ? `of ${powerLimit}W limit` : undefined}
            color="text-amber-500"
          />
          <StatMini
            icon={TrendingUp}
            label="Peak"
            value={`${peakPower}W`}
            sub={`over ${chartData.length} samples`}
            color="text-red-500"
          />
          <StatMini
            icon={Gauge}
            label="Avg / GPU"
            value={totalGpus > 0 ? `${Math.round(totalPower / totalGpus)}W` : "—"}
            sub={`${totalGpus} GPUs`}
            color="text-blue-500"
          />
          <StatMini
            icon={Activity}
            label="Average"
            value={`${avgPower}W`}
            sub="rolling window"
            color="text-purple-500"
          />
          {energyRate > 0 ? (
            <StatMini
              icon={DollarSign}
              label="Daily Est."
              value={`${currencySymbol}${dailyCost.toFixed(2)}`}
              sub={`${currencySymbol}${hourlyCost.toFixed(3)}/hr`}
              color="text-emerald-500"
            />
          ) : (
            <StatMini
              icon={DollarSign}
              label="Daily Est."
              value="—"
              sub="set energy rate in settings"
              color="text-muted-foreground"
            />
          )}
          {energyRate > 0 ? (
            <StatMini
              icon={Calendar}
              label="Monthly Est."
              value={`${currencySymbol}${monthlyCost.toFixed(0)}`}
              sub={`${currencySymbol}${(monthlyCost * 12).toFixed(0)}/yr`}
              color="text-emerald-500"
            />
          ) : (
            <StatMini
              icon={Calendar}
              label="Monthly Est."
              value="—"
              sub="set energy rate in settings"
              color="text-muted-foreground"
            />
          )}
        </div>

        {/* ── Chart ── */}
        {chartData.length > 0 ? (
          <div className="relative">
            <ResponsiveContainer width="100%" height={320}>
              {mode === "stacked" ? (
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  stackOffset="none"
                >
                  <defs>
                    {connectedHosts.map((_, i) => {
                      const c = CHART_COLORS[i % CHART_COLORS.length];
                      return (
                        <linearGradient key={i} id={`pg${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={c} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={c} stopOpacity={0.05} />
                        </linearGradient>
                      );
                    })}
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v: number) => `${v}W`}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    content={
                      <PowerTooltip
                        energyRate={energyRate}
                        currencySymbol={currencySymbol}
                        powerLimit={powerLimit}
                      />
                    }
                  />
                  {powerLimit > 0 && (
                    <ReferenceLine
                      y={powerLimit}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Limit ${powerLimit}W`,
                        position: "insideTopRight",
                        fill: "hsl(var(--destructive))",
                        fontSize: 10,
                      }}
                    />
                  )}
                  {connectedHosts.map((host, i) => {
                    const c = CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <Area
                        key={host.url}
                        type="monotone"
                        dataKey={host.name || host.url}
                        stackId="power"
                        stroke={c}
                        strokeWidth={2}
                        fill={`url(#pg${i})`}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 2, fill: c }}
                        connectNulls
                      />
                    );
                  })}
                </AreaChart>
              ) : (
                <LineChart
                  data={chartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tickFormatter={(v: number) => `${v}W`}
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={55}
                  />
                  <Tooltip
                    content={
                      <PowerTooltip
                        energyRate={energyRate}
                        currencySymbol={currencySymbol}
                        powerLimit={powerLimit}
                      />
                    }
                  />
                  {powerLimit > 0 && (
                    <ReferenceLine
                      y={powerLimit}
                      stroke="hsl(var(--destructive))"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      label={{
                        value: `Limit ${powerLimit}W`,
                        position: "insideTopRight",
                        fill: "hsl(var(--destructive))",
                        fontSize: 10,
                      }}
                    />
                  )}
                  {connectedHosts.map((host, i) => {
                    const c = CHART_COLORS[i % CHART_COLORS.length];
                    return (
                      <Line
                        key={host.url}
                        type="monotone"
                        dataKey={host.name || host.url}
                        stroke={c}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 2, fill: c }}
                        connectNulls
                      />
                    );
                  })}
                </LineChart>
              )}
            </ResponsiveContainer>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 px-1">
              {connectedHosts.map((host, i) => (
                <div key={host.url} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                  />
                  <span className="truncate max-w-[140px]">{host.name || host.url}</span>
                </div>
              ))}
              {powerLimit > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="inline-block h-0.5 w-3 rounded bg-destructive" />
                  <span>Power Limit</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[320px] text-muted-foreground">
            <div className="text-center space-y-2">
              <div className="relative mx-auto w-12 h-12">
                <Zap className="h-12 w-12 opacity-20" />
                <Zap className="h-12 w-12 absolute inset-0 animate-pulse opacity-40" />
              </div>
              <p className="text-sm font-medium">Collecting power data...</p>
              <p className="text-xs">
                Data will appear after a few refresh cycles
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default PowerUsageChart;