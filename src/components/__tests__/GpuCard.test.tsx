import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GpuCard } from "@/components/GpuCard";
import type { GpuInfo } from "@/types/gpu";

function makeGpu(overrides: Partial<GpuInfo> = {}): GpuInfo {
  return {
    id: 2,
    uuid: "GPU-test",
    name: "NVIDIA RTX 6000 Ada",
    driverVersion: "550.54",
    temperature: 62,
    utilization: 76,
    memory: { used: 10_240, total: 24_576 },
    power: { draw: 280, limit: 700 },
    fan: 64,
    processes: [],
    ...overrides,
  };
}

describe("GpuCard", () => {
  it("renders a concise header, accessible metric meters and capacity details", () => {
    render(<GpuCard gpu={makeGpu()} energyRate={0.2} currencySymbol="€" />);

    expect(screen.getByRole("heading", { name: "RTX 6000 Ada" })).toBeInTheDocument();
    expect(screen.getByText("GPU 2")).toBeInTheDocument();
    expect(screen.getByLabelText("GPU 2 status: Active")).toBeInTheDocument();
    expect(screen.getByText("Driver 550.54")).toBeInTheDocument();

    expect(screen.getByText("10.0 GB / 24.0 GB (42%)")).toBeInTheDocument();
    expect(screen.getByText("280W / 700W (40%)")).toBeInTheDocument();
    expect(screen.getByText("64%")).toBeInTheDocument();
    expect(screen.getByText("€0.056/hr")).toBeInTheDocument();

    expect(screen.getByRole("meter", { name: "Utilization for GPU 2" })).toHaveAttribute("aria-valuenow", "76");
    expect(screen.getByRole("meter", { name: "VRAM for GPU 2" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("meter", { name: "Temperature for GPU 2" })).toHaveAttribute("aria-valuenow", "62");
    expect(screen.getByRole("meter", { name: "Power for GPU 2" })).toHaveAttribute("aria-valuenow", "40");
  });

  it("derives status pills from temperature, memory and idle utilization", () => {
    const { rerender } = render(<GpuCard gpu={makeGpu({ temperature: 86 })} />);
    expect(screen.getByLabelText("GPU 2 status: Hot")).toBeInTheDocument();

    rerender(<GpuCard gpu={makeGpu({ temperature: 45, memory: { used: 39_000, total: 40_000 } })} />);
    expect(screen.getByLabelText("GPU 2 status: VRAM full")).toBeInTheDocument();

    rerender(<GpuCard gpu={makeGpu({ temperature: 32, utilization: 0, memory: { used: 512, total: 24_576 } })} />);
    expect(screen.getByLabelText("GPU 2 status: Idle")).toBeInTheDocument();
  });

  it("sorts processes by memory, preserves enrichment and limits the visible list", () => {
    const processes = [
      { pid: 1, name: "small-tail", memory: 512 },
      { pid: 2, name: "big-train", memory: 10_240, category: "ai", runtime: "cuda", model: "llama-70b" },
      { pid: 3, name: "render", memory: 4_096 },
      { pid: 4, name: "analytics", memory: 8_192 },
      { pid: 5, name: "worker", memory: 2_048 },
      { pid: 6, name: "notebook", memory: 6_144 },
    ] as unknown as GpuInfo["processes"];

    render(<GpuCard gpu={makeGpu({ processes })} />);

    const processList = screen.getByRole("list", { name: "Top GPU processes" });
    const items = within(processList).getAllByRole("listitem");

    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent("big-train");
    expect(items[0]).toHaveTextContent("10.0 GB");
    expect(items[1]).toHaveTextContent("analytics");
    expect(items[2]).toHaveTextContent("notebook");
    expect(screen.getByText("cuda")).toBeInTheDocument();
    expect(screen.getByText("llama-70b")).toBeInTheDocument();
    expect(screen.getByText("+1 more")).toBeInTheDocument();
    expect(screen.queryByText("small-tail")).not.toBeInTheDocument();
  });
});
