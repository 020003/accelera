import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InfiniBandInspector } from "../InfiniBandInspector";
import type { FabricSnapshot } from "@/hooks/useFabricLive";

const snapshot: FabricSnapshot = {
  host: "gpu-1",
  hostUrl: "http://10.0.0.11:5000/nvidia-smi.json",
  timestamp: 1,
  nvlink: [],
  infiniband: [{
    device: "mlx5_1",
    port: 1,
    state: "ACTIVE",
    physical_state: "LinkUp",
    rate_gbps: 100,
    link_layer: "Ethernet",
    lid: "0x0",
    sm_lid: "0x0",
    gids: ["fe80::1", "::ffff:10.0.0.11"],
    pkeys: ["0xffff"],
    netdev: "ens108f1np1",
    tx_bytes: 10,
    rx_bytes: 20,
    tx_bps: 100,
    rx_bps: 200,
    rdma_tx_bps: 100,
    rdma_rx_bps: 200,
    rdma_available: true,
    counter_source: "vport:ens108f1np1",
    errors: { link_downed: 0, symbol_errors: 0 },
  }],
};

describe("InfiniBandInspector", () => {
  it("renders full RoCE port metadata and marks LIDs not applicable", () => {
    render(<InfiniBandInspector hostName="gpu-node-01" hostUrl={snapshot.hostUrl} snapshot={snapshot} onClose={vi.fn()} />);
    expect(screen.getByText("gpu-node-01")).toBeInTheDocument();
    expect(screen.getAllByText("N/A for RoCE")).toHaveLength(2);
    expect(screen.getAllByText((_, element) => element?.textContent === "0: fe80::1").length).toBeGreaterThan(0);
    expect(screen.getByText("0: 0xffff")).toBeInTheDocument();
    expect(screen.getByText("vport:ens108f1np1")).toBeInTheDocument();
  });
});
