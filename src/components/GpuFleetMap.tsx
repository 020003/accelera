import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Download, LayoutGrid, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FLEET_METRICS,
  LEVEL_STYLES,
  exportFleetCsv,
  formatMetric,
  gpuMetricValue,
  metricFill,
  metricLevel,
  summarizeFleetHealth,
  type FleetMetric,
  type MetricLevel,
} from "@/lib/fleetMetrics";
import type { HostData } from "@/types/dashboard";

const METRIC_STORAGE_KEY = "accelera_fleet_map_metric";

interface GpuFleetMapProps {
  hostsData: HostData[];
  onSelectHost?: (hostUrl: string) => void;
}

function shortGpuName(name: string): string {
  return name.replace(/^NVIDIA\s+/i, "").replace(/\s+(PCIe|SXM\d?)\b.*$/i, "").trim();
}

export function GpuFleetMap({ hostsData, onSelectHost }: GpuFleetMapProps) {
  const [metric, setMetric] = useState<FleetMetric>(() => {
    const stored = localStorage.getItem(METRIC_STORAGE_KEY) as FleetMetric | null;
    return FLEET_METRICS.some((m) => m.value === stored) ? (stored as FleetMetric) : "utilization";
  });
  const health = summarizeFleetHealth(hostsData);

  const changeMetric = (value: string) => {
    if (!value) return;
    setMetric(value as FleetMetric);
    localStorage.setItem(METRIC_STORAGE_KEY, value);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <LayoutGrid className="h-4 w-4 text-muted-foreground" />
              GPU Fleet Map
            </CardTitle>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span><span className="font-mono text-foreground">{health.totalGpus}</span> GPUs</span>
              <span><span className="font-mono text-amber-500">{health.busyGpus}</span> busy</span>
              <span><span className="font-mono text-foreground">{health.idleGpus}</span> idle</span>
              {health.hotGpus > 0 && <span><span className="font-mono text-red-500">{health.hotGpus}</span> hot</span>}
              {health.memoryPressureGpus > 0 && (
                <span><span className="font-mono text-red-500">{health.memoryPressureGpus}</span> VRAM-saturated</span>
              )}
              {health.offlineHosts > 0 && (
                <span><span className="font-mono text-red-500">{health.offlineHosts}</span> host{health.offlineHosts !== 1 ? "s" : ""} offline</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ToggleGroup
              type="single"
              value={metric}
              onValueChange={changeMetric}
              className="h-7 rounded-lg bg-muted/40 p-0.5"
              aria-label="Fleet map metric"
            >
              {FLEET_METRICS.map((m) => (
                <ToggleGroupItem key={m.value} value={m.value} className="h-6 px-2 text-[11px]">
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[11px]"
              onClick={() => exportFleetCsv(hostsData)}
              disabled={hostsData.length === 0}
              title="Download the current per-GPU snapshot as CSV"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn("grid gap-x-6 gap-y-2.5", hostsData.length > 1 && "xl:grid-cols-2")}>
        {hostsData.map((host) => (
          <div key={host.url} className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:items-center">
            <button
              type="button"
              onClick={() => onSelectHost?.(host.url)}
              className="group flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={`Open ${host.name}`}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  host.isConnected ? (host.stale ? "bg-amber-500" : "bg-emerald-500") : "bg-red-500",
                )}
              />
              <span className="truncate text-xs font-medium group-hover:text-primary">{host.name}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {host.isConnected ? `${host.gpus.length}×` : ""}
              </span>
            </button>

            {host.isConnected && host.gpus.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5">
                {host.gpus.map((gpu) => {
                  const value = gpuMetricValue(gpu, metric);
                  const level = metricLevel(value, metric);
                  const styles = LEVEL_STYLES[level];
                  return (
                    <Tooltip key={`${host.url}-${gpu.id}`}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onSelectHost?.(host.url)}
                          aria-label={`${host.name} GPU ${gpu.id}: ${formatMetric(value, metric)} ${FLEET_METRICS.find((m) => m.value === metric)?.label}`}
                          className={cn(
                            "fleet-tile relative h-12 overflow-hidden rounded-md border border-border/60 bg-muted/30 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            level === "critical" && "ring-1 ring-inset",
                            level === "critical" && styles.ring,
                          )}
                        >
                          <span
                            className={cn("absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out", styles.bar)}
                            style={{ height: `${Math.max(metricFill(value, metric), 4)}%`, opacity: 0.28 }}
                          />
                          <span className="relative flex h-full flex-col justify-between px-1.5 py-1">
                            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">GPU {gpu.id}</span>
                            <span className={cn("font-mono text-xs font-semibold leading-none", styles.text)}>
                              {formatMetric(value, metric)}
                            </span>
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="w-56 p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{shortGpuName(gpu.name)}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{host.name}·{gpu.id}</span>
                        </div>
                        <div className="space-y-1.5">
                          {FLEET_METRICS.map((m) => {
                            const v = gpuMetricValue(gpu, m.value);
                            const l: MetricLevel = metricLevel(v, m.value);
                            return (
                              <div key={m.value} className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-2 text-[11px]">
                                <span className="text-muted-foreground">{m.label}</span>
                                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <span
                                    className={cn("block h-full rounded-full", LEVEL_STYLES[l].bar)}
                                    style={{ width: `${metricFill(v, m.value)}%` }}
                                  />
                                </span>
                                <span className={cn("text-right font-mono", LEVEL_STYLES[l].text)}>{formatMetric(v, m.value)}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-2 flex justify-between border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
                          <span>{(gpu.memory.used / 1024).toFixed(1)}/{(gpu.memory.total / 1024).toFixed(0)} GB</span>
                          <span>{Math.round(gpu.power.draw)}/{Math.round(gpu.power.limit)} W</span>
                          <span>{gpu.processes?.length ?? 0} proc</span>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-12 items-center gap-2 rounded-md border border-dashed border-red-500/30 bg-red-500/5 px-3 text-xs text-red-500">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{host.isConnected ? "No GPUs reported" : host.error || "Host unreachable"}</span>
              </div>
            )}
          </div>
        ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 pt-1 text-[10px] text-muted-foreground">
          {(Object.keys(LEVEL_STYLES) as MetricLevel[]).map((level) => (
            <span key={level} className="flex items-center gap-1.5">
              <span className={cn("h-2 w-2 rounded-sm", LEVEL_STYLES[level].bar)} />
              {LEVEL_STYLES[level].label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
