import type { HostData } from "@/types/dashboard";
import type { GpuInfo } from "@/types/gpu";

export type FleetMetric = "utilization" | "memory" | "temperature" | "power";
export type MetricLevel = "idle" | "normal" | "elevated" | "critical";

export const FLEET_METRICS: { value: FleetMetric; label: string; unit: string }[] = [
  { value: "utilization", label: "Utilization", unit: "%" },
  { value: "memory", label: "VRAM", unit: "%" },
  { value: "temperature", label: "Temperature", unit: "°C" },
  { value: "power", label: "Power", unit: "%" },
];

// Thresholds are [elevated, critical]; anything below `idle` is shown as idle.
const THRESHOLDS: Record<FleetMetric, { idle: number; elevated: number; critical: number }> = {
  utilization: { idle: 5, elevated: 70, critical: 90 },
  memory: { idle: 5, elevated: 80, critical: 95 },
  temperature: { idle: 35, elevated: 75, critical: 85 },
  power: { idle: 15, elevated: 80, critical: 95 },
};

function pct(part: number, whole: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return 0;
  return Math.max(0, Math.min(100, (part / whole) * 100));
}

/** Raw value of a metric for one GPU (percentages for everything except temperature). */
export function gpuMetricValue(gpu: GpuInfo, metric: FleetMetric): number {
  switch (metric) {
    case "utilization":
      return Math.max(0, Math.min(100, gpu.utilization || 0));
    case "memory":
      return pct(gpu.memory?.used ?? 0, gpu.memory?.total ?? 0);
    case "temperature":
      return Math.max(0, gpu.temperature || 0);
    case "power":
      return pct(gpu.power?.draw ?? 0, gpu.power?.limit ?? 0);
  }
}

/** 0–100 fill ratio used for bars/intensity (temperature is mapped onto 20–95 °C). */
export function metricFill(value: number, metric: FleetMetric): number {
  if (metric === "temperature") return Math.max(0, Math.min(100, ((value - 20) / 75) * 100));
  return Math.max(0, Math.min(100, value));
}

export function metricLevel(value: number, metric: FleetMetric): MetricLevel {
  const t = THRESHOLDS[metric];
  if (value >= t.critical) return "critical";
  if (value >= t.elevated) return "elevated";
  if (value < t.idle) return "idle";
  return "normal";
}

export const LEVEL_STYLES: Record<MetricLevel, { text: string; bar: string; ring: string; label: string }> = {
  idle: { text: "text-muted-foreground", bar: "bg-slate-400/60", ring: "ring-slate-400/30", label: "Idle" },
  normal: { text: "text-emerald-500", bar: "bg-emerald-500", ring: "ring-emerald-500/40", label: "Normal" },
  elevated: { text: "text-amber-500", bar: "bg-amber-500", ring: "ring-amber-500/50", label: "Elevated" },
  critical: { text: "text-red-500", bar: "bg-red-500", ring: "ring-red-500/60", label: "Critical" },
};

export function formatMetric(value: number, metric: FleetMetric): string {
  return metric === "temperature" ? `${Math.round(value)}°C` : `${Math.round(value)}%`;
}

export interface FleetHealthSummary {
  totalGpus: number;
  busyGpus: number;
  idleGpus: number;
  hotGpus: number;
  memoryPressureGpus: number;
  offlineHosts: number;
}

export function summarizeFleetHealth(hosts: HostData[]): FleetHealthSummary {
  const gpus = hosts.filter((h) => h.isConnected).flatMap((h) => h.gpus);
  return {
    totalGpus: gpus.length,
    busyGpus: gpus.filter((g) => gpuMetricValue(g, "utilization") >= THRESHOLDS.utilization.elevated).length,
    idleGpus: gpus.filter((g) => gpuMetricValue(g, "utilization") < THRESHOLDS.utilization.idle).length,
    hotGpus: gpus.filter((g) => gpuMetricValue(g, "temperature") >= THRESHOLDS.temperature.elevated).length,
    memoryPressureGpus: gpus.filter((g) => gpuMetricValue(g, "memory") >= THRESHOLDS.memory.critical).length,
    offlineHosts: hosts.filter((h) => !h.isConnected).length,
  };
}

function csvCell(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  // Neutralise spreadsheet formula injection and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const CSV_HEADER = [
  "host",
  "host_url",
  "host_online",
  "gpu_index",
  "gpu_name",
  "gpu_uuid",
  "utilization_pct",
  "memory_used_mib",
  "memory_total_mib",
  "memory_pct",
  "temperature_c",
  "power_draw_w",
  "power_limit_w",
  "fan_pct",
  "process_count",
  "sample_time",
];

/** Serialises the current fleet snapshot into one CSV row per GPU (offline hosts get one empty row). */
export function fleetSnapshotToCsv(hosts: HostData[]): string {
  const rows: unknown[][] = [];
  for (const host of hosts) {
    if (!host.isConnected || host.gpus.length === 0) {
      rows.push([host.name, host.url, host.isConnected, "", "", "", "", "", "", "", "", "", "", "", "", host.timestamp ?? ""]);
      continue;
    }
    for (const gpu of host.gpus) {
      rows.push([
        host.name,
        host.url,
        true,
        gpu.id,
        gpu.name,
        gpu.uuid ?? "",
        Math.round(gpu.utilization ?? 0),
        Math.round(gpu.memory?.used ?? 0),
        Math.round(gpu.memory?.total ?? 0),
        Math.round(gpuMetricValue(gpu, "memory")),
        Math.round(gpu.temperature ?? 0),
        Number((gpu.power?.draw ?? 0).toFixed(1)),
        Number((gpu.power?.limit ?? 0).toFixed(1)),
        gpu.fan ?? "",
        gpu.processes?.length ?? 0,
        host.timestamp ?? "",
      ]);
    }
  }
  return [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export function downloadTextFile(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportFleetCsv(hosts: HostData[]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadTextFile(`accelera-fleet-${stamp}.csv`, fleetSnapshotToCsv(hosts));
}
