import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VllmOperationsPanel } from "../VllmOperationsPanel";
import type { LLMStatus } from "@/hooks/useTokenStats";
import type { HostData } from "@/types/dashboard";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: () => <div />,
  Area: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const discovery: NonNullable<HostData["vllm"]> = {
  isAvailable: true,
  version: "0.21.0",
  vllmUrls: ["http://gpu-1:8000"],
  models: [{ id: "Qwen/Qwen3-32B", max_model_len: 32768 }],
};

const status: LLMStatus = {
  runtime: "vllm",
  available: true,
  collected_at: 1_700_000_000,
  scheduler: { running: 3, waiting: 0, swapped: 0 },
  cache: { gpu_usage_pct: 62.5, cpu_usage_pct: 0 },
  prefix_cache: { queries: 1000, hits: 750, hit_rate_pct: 75 },
  preemptions: 0,
  counters: { prompt_tokens: 5000, generated_tokens: 8000, successful_requests: 42 },
  throughput: { prompt_tokens_per_second: 25, generation_tokens_per_second: 75, total_tokens_per_second: 100 },
  endpoints: ["http://gpu-1:8000"],
  instances: [{
    endpoint: "http://gpu-1:8000",
    scheduler: { running: 3, waiting: 0, swapped: 0 },
    cache: { gpu_usage_pct: 62.5, cpu_usage_pct: 0 },
    prefix_cache: { queries: 1000, hits: 750, hit_rate_pct: 75 },
    preemptions: 0,
    counters: { prompt_tokens: 5000, generated_tokens: 8000, successful_requests: 42 },
  }],
};

describe("VllmOperationsPanel", () => {
  it("renders live queue, cache, throughput, instances, and models", () => {
    render(<VllmOperationsPanel status={status} discovery={discovery} />);

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Inference operations")).toBeInTheDocument();
    expect(screen.getAllByText("3")).toHaveLength(2);
    expect(screen.getAllByText("62.5%")).toHaveLength(2);
    expect(screen.getByText("100.0")).toBeInTheDocument();
    expect(screen.getByText("gpu-1:8000")).toBeInTheDocument();
    expect(screen.getByText("Qwen/Qwen3-32B")).toBeInTheDocument();
    expect(screen.getByText("32.8K token context")).toBeInTheDocument();
  });

  it("marks a backed-up scheduler as congested", () => {
    const congested = {
      ...status,
      scheduler: { running: 2, waiting: 8, swapped: 1 },
      cache: { gpu_usage_pct: 97, cpu_usage_pct: 0 },
    };

    render(<VllmOperationsPanel status={congested} discovery={discovery} />);

    expect(screen.getByText("Congested")).toBeInTheDocument();
    expect(screen.getByText("80% queue pressure")).toBeInTheDocument();
    expect(screen.getAllByText("97.0%")).toHaveLength(2);
  });
});
