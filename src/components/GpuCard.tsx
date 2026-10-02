import { memo, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { GpuInfo } from "@/types/gpu";
import {
  gpuMetricValue,
  LEVEL_STYLES,
  metricFill,
  metricLevel,
  type FleetMetric,
  type MetricLevel,
} from "@/lib/fleetMetrics";
import { 
  Activity, 
  HardDrive, 
  Thermometer, 
  Zap, 
  Fan,
  Cpu,
  Clock,
  Brain,
  Box,
} from "lucide-react";

interface GpuCardProps {
  gpu: GpuInfo;
  energyRate?: number;
  currencySymbol?: string;
}

type EnrichedGpuProcess = NonNullable<GpuInfo["processes"]>[number] & {
  category?: string;
  runtime?: string;
  model?: string;
};

interface StatusPill {
  label: "Idle" | "Active" | "Hot" | "VRAM full";
  level: MetricLevel;
}

function shortGpuName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, "");
}

function fmtGb(mib: number): string {
  return `${(mib / 1024).toFixed(1)} GB`;
}

function fmtWatts(watts: number): string {
  return `${Math.round(watts)}W`;
}

function gpuStatus(gpu: GpuInfo): StatusPill {
  const temperature = gpuMetricValue(gpu, "temperature");
  const temperatureLevel = metricLevel(temperature, "temperature");
  if (temperatureLevel === "critical" || temperatureLevel === "elevated") {
    return { label: "Hot", level: temperatureLevel };
  }

  const memoryLevel = metricLevel(gpuMetricValue(gpu, "memory"), "memory");
  if (memoryLevel === "critical") {
    return { label: "VRAM full", level: "critical" };
  }

  const utilizationLevel = metricLevel(gpuMetricValue(gpu, "utilization"), "utilization");
  if (utilizationLevel === "idle") {
    return { label: "Idle", level: "idle" };
  }

  return { label: "Active", level: utilizationLevel === "critical" ? "elevated" : utilizationLevel };
}

function MetricBar({
  label,
  metric,
  value,
  valueText,
}: {
  label: string;
  metric: FleetMetric;
  value: number;
  valueText: string;
}) {
  const fill = metricFill(value, metric);
  const level = metricLevel(value, metric);
  const styles = LEVEL_STYLES[level];

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(metric === "temperature" ? value : fill)}
      aria-valuetext={valueText}
      className="h-2.5 overflow-hidden rounded-full bg-muted"
    >
      <div className={`h-full rounded-full transition-all ${styles.bar}`} style={{ width: `${fill}%` }} />
    </div>
  );
}

function MetricRow({
  icon,
  label,
  barLabel,
  metric,
  value,
  valueText,
}: {
  icon: ReactNode;
  label: string;
  barLabel: string;
  metric: FleetMetric;
  value: number;
  valueText: string;
}) {
  const level = metricLevel(value, metric);
  const styles = LEVEL_STYLES[level];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-sm font-medium">{label}</span>
        </div>
        <span className={`shrink-0 font-mono text-sm font-bold ${styles.text}`}>{valueText}</span>
      </div>
      <MetricBar label={barLabel} metric={metric} value={value} valueText={valueText} />
    </div>
  );
}

export const GpuCard = memo(function GpuCard({ gpu, energyRate = 0, currencySymbol = "$" }: GpuCardProps) {
  const utilizationValue = gpuMetricValue(gpu, "utilization");
  const memoryUsedPercent = gpuMetricValue(gpu, "memory");
  const temperatureValue = gpuMetricValue(gpu, "temperature");
  const powerUsedPercent = gpuMetricValue(gpu, "power");
  const hasFan = typeof gpu.fan === "number" && Number.isFinite(gpu.fan);
  const hourlyEnergyCost = energyRate > 0 ? (gpu.power.draw / 1000) * energyRate : 0;
  const status = gpuStatus(gpu);
  const statusStyles = LEVEL_STYLES[status.level];
  const processes = ([...(gpu.processes ?? [])] as EnrichedGpuProcess[]).sort((a, b) => b.memory - a.memory);
  const visibleProcesses = processes.slice(0, 5);
  const hiddenProcessCount = Math.max(0, processes.length - visibleProcesses.length);

  return (
    <Card className="gpu-card overflow-hidden border-border bg-card/95">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <CardTitle className="truncate text-lg font-semibold text-foreground" title={gpu.name}>
              {shortGpuName(gpu.name)}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>GPU {gpu.id}</span>
              {gpu.driverVersion && (
                <>
                  <span>•</span>
                  <span>Driver {gpu.driverVersion}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge
              variant="outline"
              className={`border-border bg-muted/60 ring-1 ${statusStyles.ring} ${statusStyles.text}`}
              aria-label={`GPU ${gpu.id} status: ${status.label}`}
            >
              {status.label}
            </Badge>
            <Badge variant="outline" className="border-border bg-background/70 text-foreground">
              <Thermometer className="mr-1 h-3 w-3" aria-hidden="true" />
              {Math.round(temperatureValue)}°C
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4 rounded-xl border border-border/60 bg-muted/20 p-4">
          <MetricRow
            icon={<Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            label="Utilization"
            barLabel={`Utilization for GPU ${gpu.id}`}
            metric="utilization"
            value={utilizationValue}
            valueText={`${Math.round(utilizationValue)}%`}
          />
          <MetricRow
            icon={<HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            label="VRAM"
            barLabel={`VRAM for GPU ${gpu.id}`}
            metric="memory"
            value={memoryUsedPercent}
            valueText={`${fmtGb(gpu.memory.used)} / ${fmtGb(gpu.memory.total)} (${Math.round(memoryUsedPercent)}%)`}
          />
          <MetricRow
            icon={<Thermometer className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            label="Temperature"
            barLabel={`Temperature for GPU ${gpu.id}`}
            metric="temperature"
            value={temperatureValue}
            valueText={`${Math.round(temperatureValue)}°C`}
          />
          <MetricRow
            icon={<Zap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
            label="Power"
            barLabel={`Power for GPU ${gpu.id}`}
            metric="power"
            value={powerUsedPercent}
            valueText={`${fmtWatts(gpu.power.draw)} / ${fmtWatts(gpu.power.limit)} (${Math.round(powerUsedPercent)}%)`}
          />
        </div>

        <div className={`grid gap-4 ${hasFan ? "sm:grid-cols-2" : ""}`}>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">Power cap</span>
            </div>
            <div className="space-y-1">
              <div className="font-mono text-lg font-bold">{fmtWatts(gpu.power.draw)}</div>
              <div className="text-xs text-muted-foreground">
                {Math.round(powerUsedPercent)}% of {fmtWatts(gpu.power.limit)} cap
              </div>
              {hourlyEnergyCost > 0 && (
                <div className="text-xs font-medium text-emerald-500">
                  {currencySymbol}
                  {hourlyEnergyCost.toFixed(3)}/hr
                </div>
              )}
            </div>
          </div>

          {hasFan && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Fan className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">Fan</span>
              </div>
              <div className="space-y-1">
                <div className="font-mono text-lg font-bold">{gpu.fan}%</div>
                <div className="text-xs text-muted-foreground">
                  {gpu.fan > 0 ? "Active cooling" : "Passive cooling"}
                </div>
              </div>
            </div>
          )}
        </div>

        {processes.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm font-medium">Running Processes ({processes.length})</span>
            </div>
            <div role="list" aria-label="Top GPU processes" className="space-y-1.5">
              {visibleProcesses.map((proc) => (
                <div
                  key={`${proc.pid}-${proc.name}`}
                  role="listitem"
                  className={`flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-2.5 ${
                    proc.category === "ai" ? "border-l-2 border-l-purple-500/50" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {proc.category === "ai" && <Brain className="h-3 w-3 shrink-0 text-purple-500" aria-hidden="true" />}
                      <span className="truncate text-sm font-medium">{proc.name}</span>
                      {proc.runtime && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                          {proc.runtime}
                        </span>
                      )}
                    </div>
                    {proc.model && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Box className="h-2.5 w-2.5 text-purple-400" aria-hidden="true" />
                        <span className="truncate text-[11px] font-medium text-purple-400">{proc.model}</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">PID: {proc.pid}</div>
                  </div>
                  <div className="shrink-0 font-mono text-sm font-bold text-foreground">
                    {fmtGb(proc.memory)}
                  </div>
                </div>
              ))}
              {hiddenProcessCount > 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">+{hiddenProcessCount} more</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="mx-auto mb-2 h-8 w-8 opacity-50" aria-hidden="true" />
            <div className="text-sm">No active GPU processes</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default GpuCard;