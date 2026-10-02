import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GpuFleetMap } from "@/components/GpuFleetMap";
import { CommandPalette } from "@/components/CommandPalette";
import type { HostData } from "@/types/dashboard";

// cmdk relies on browser APIs that jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const hosts: HostData[] = [
  {
    url: "http://10.0.0.1:5000/nvidia-smi.json",
    name: "srv01",
    isConnected: true,
    gpus: [
      { id: 0, name: "NVIDIA H100", temperature: 45, utilization: 97, memory: { used: 70_000, total: 80_000 }, power: { draw: 600, limit: 700 } },
      { id: 1, name: "NVIDIA H100", temperature: 30, utilization: 0, memory: { used: 0, total: 80_000 }, power: { draw: 60, limit: 700 } },
    ],
  },
  { url: "http://10.0.0.2:5000/nvidia-smi.json", name: "srv02", isConnected: false, gpus: [], error: "Connection refused" },
];

describe("GpuFleetMap", () => {
  it("renders one tile per GPU, offline hosts and navigates on click", () => {
    const onSelectHost = vi.fn();
    render(
      <TooltipProvider>
        <GpuFleetMap hostsData={hosts} onSelectHost={onSelectHost} />
      </TooltipProvider>,
    );
    expect(screen.getByLabelText(/srv01 GPU 0: 97% Utilization/)).toBeInTheDocument();
    expect(screen.getByLabelText(/srv01 GPU 1: 0% Utilization/)).toBeInTheDocument();
    expect(screen.getByText("Connection refused")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/srv01 GPU 0/));
    expect(onSelectHost).toHaveBeenCalledWith(hosts[0].url);
  });

  it("switches the displayed metric", () => {
    render(
      <TooltipProvider>
        <GpuFleetMap hostsData={hosts} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Temperature" }));
    expect(screen.getByLabelText(/srv01 GPU 0: 45°C Temperature/)).toBeInTheDocument();
  });
});

describe("CommandPalette", () => {
  it("opens with Ctrl+K, supports Alt+digit and navigates to a host", () => {
    const onNavigate = vi.fn();
    const onOpenChange = vi.fn();
    const props = {
      hostsData: hosts,
      onNavigate,
      onRefresh: vi.fn(),
      onToggleTheme: vi.fn(),
      theme: "dark",
      onExportCsv: vi.fn(),
      performanceMode: "balanced" as const,
      onPerformanceMode: vi.fn(),
    };
    const { rerender } = render(<CommandPalette open={false} onOpenChange={onOpenChange} {...props} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);

    fireEvent.keyDown(window, { key: "4", code: "Digit4", altKey: true });
    expect(onNavigate).toHaveBeenCalledWith("alerts");

    rerender(<CommandPalette open onOpenChange={onOpenChange} {...props} />);
    fireEvent.click(screen.getByText("srv02"));
    expect(onNavigate).toHaveBeenCalledWith(hosts[1].url);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
