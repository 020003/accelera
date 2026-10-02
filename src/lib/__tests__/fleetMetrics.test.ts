import { describe, it, expect } from "vitest";
import {
  fleetSnapshotToCsv,
  gpuMetricValue,
  metricFill,
  metricLevel,
  summarizeFleetHealth,
} from "@/lib/fleetMetrics";
import type { HostData } from "@/types/dashboard";
import type { GpuInfo } from "@/types/gpu";

const gpu = (overrides: Partial<GpuInfo> = {}): GpuInfo => ({
  id: 0,
  name: "NVIDIA H100",
  temperature: 50,
  utilization: 40,
  memory: { used: 40_000, total: 80_000 },
  power: { draw: 350, limit: 700 },
  ...overrides,
});

describe("fleetMetrics", () => {
  it("computes per-GPU metric values as bounded percentages", () => {
    const g = gpu();
    expect(gpuMetricValue(g, "utilization")).toBe(40);
    expect(gpuMetricValue(g, "memory")).toBe(50);
    expect(gpuMetricValue(g, "power")).toBe(50);
    expect(gpuMetricValue(g, "temperature")).toBe(50);
    expect(gpuMetricValue(gpu({ memory: { used: 10, total: 0 } }), "memory")).toBe(0);
    expect(gpuMetricValue(gpu({ utilization: 140 }), "utilization")).toBe(100);
  });

  it("classifies levels per metric", () => {
    expect(metricLevel(2, "utilization")).toBe("idle");
    expect(metricLevel(50, "utilization")).toBe("normal");
    expect(metricLevel(75, "utilization")).toBe("elevated");
    expect(metricLevel(95, "utilization")).toBe("critical");
    expect(metricLevel(86, "temperature")).toBe("critical");
    expect(metricLevel(60, "temperature")).toBe("normal");
  });

  it("maps temperature onto a 20-95°C fill range", () => {
    expect(metricFill(20, "temperature")).toBe(0);
    expect(metricFill(95, "temperature")).toBe(100);
    expect(metricFill(57.5, "temperature")).toBe(50);
    expect(metricFill(42, "utilization")).toBe(42);
  });

  it("summarises fleet health across online hosts only", () => {
    const hosts: HostData[] = [
      { url: "a", name: "a", isConnected: true, gpus: [gpu({ utilization: 95, temperature: 80 }), gpu({ id: 1, utilization: 0 })] },
      { url: "b", name: "b", isConnected: false, gpus: [gpu({ utilization: 99 })] },
    ];
    expect(summarizeFleetHealth(hosts)).toEqual({
      totalGpus: 2,
      busyGpus: 1,
      idleGpus: 1,
      hotGpus: 1,
      memoryPressureGpus: 0,
      offlineHosts: 1,
    });
  });

  it("exports one CSV row per GPU and escapes risky cells", () => {
    const hosts: HostData[] = [
      { url: "http://10.0.0.1:5000/nvidia-smi.json", name: "=cmd,1", isConnected: true, gpus: [gpu(), gpu({ id: 1 })], timestamp: "t" },
      { url: "http://10.0.0.2:5000/nvidia-smi.json", name: "down", isConnected: false, gpus: [] },
    ];
    const lines = fleetSnapshotToCsv(hosts).trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0].startsWith("host,host_url,host_online,gpu_index")).toBe(true);
    expect(lines[1].startsWith(`"'=cmd,1",`)).toBe(true);
    expect(lines[1]).toContain(",40,40000,80000,50,50,350,700,");
    expect(lines[3].startsWith("down,http://10.0.0.2:5000/nvidia-smi.json,false,")).toBe(true);
  });
});
