import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cable, Cpu, Network, Wifi } from "lucide-react";
import { useFabricLive, type FabricResult } from "@/hooks/useFabricLive";

interface Host {
  url: string;
  name: string;
}

interface Props {
  hosts: Host[];
}

function fmtBps(bps: number): string {
  if (bps <= 0) return "—";
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} GB/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} KB/s`;
  return `${Math.round(bps)} B/s`;
}

function fmtBytes(b: number): string {
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`;
  if (b >= 1e9)  return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6)  return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3)  return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}

/** Utilisation 0..1 of a port's nominal capacity (rate_gbps is line-rate, both directions). */
function utilization(bps: number, lineGbps: number): number {
  if (lineGbps <= 0) return 0;
  // line-rate is per-direction; convert Gb/s → bytes/s
  const peakBps = (lineGbps * 1e9) / 8;
  return Math.min(1, bps / peakBps);
}

/** Two clearly-stacked TX/RX bars with visible empty tracks.
 *  An idle direction still shows its full track + label so the user
 *  can see "this direction exists, it's just zero right now". */
function SplitBar({ tx, rx, line }: { tx: number; rx: number; line: number }) {
  const utx = utilization(tx, line) * 100;
  const urx = utilization(rx, line) * 100;
  const hasTx = tx > 0;
  const hasRx = rx > 0;
  return (
    <div className="flex flex-col gap-1 min-w-[240px] flex-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 w-10 text-blue-500 font-medium">
          <ArrowUpFromLine className="h-3 w-3" /> TX
        </span>
        <div className="flex-1 h-2 rounded-full bg-muted border border-border/40 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${utx}%`, opacity: hasTx ? 1 : 0 }}
          />
        </div>
        <span
          className="font-mono tabular-nums w-[80px] text-right text-blue-500"
          style={{ opacity: hasTx ? 1 : 0.5 }}
        >
          {hasTx ? fmtBps(tx) : "0 B/s"}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="flex items-center gap-1 w-10 text-emerald font-medium">
          <ArrowDownToLine className="h-3 w-3" /> RX
        </span>
        <div className="flex-1 h-2 rounded-full bg-muted border border-border/40 overflow-hidden">
          <div
            className="h-full bg-emerald transition-all"
            style={{ width: `${urx}%`, opacity: hasRx ? 1 : 0 }}
          />
        </div>
        <span
          className="font-mono tabular-nums w-[80px] text-right text-emerald"
          style={{ opacity: hasRx ? 1 : 0.5 }}
        >
          {hasRx ? fmtBps(rx) : "0 B/s"}
        </span>
      </div>
    </div>
  );
}

// A port is "busy" if it's currently moving > IDLE_THRESHOLD bytes/sec.
// Below that we treat it as idle-active and render compactly.
const IDLE_THRESHOLD = 1_000_000; // 1 MB/s

function HostFabricRow({ host, result }: { host: Host; result?: FabricResult }) {
  const data = result?.data;
  const ib = data?.infiniband ?? [];
  const nvl = data?.nvlink ?? [];
  const ibBusy = ib.filter((p) => p.state === "ACTIVE" && (p.tx_bps + p.rx_bps) >= IDLE_THRESHOLD);
  const ibIdleActive = ib.filter((p) => p.state === "ACTIVE" && (p.tx_bps + p.rx_bps) < IDLE_THRESHOLD);
  const ibDown = ib.filter((p) => p.state !== "ACTIVE");
  const nvlBusy = nvl.filter((l) => l.state === "active" && (l.tx_bps + l.rx_bps) >= IDLE_THRESHOLD);
  const nvlIdleActive = nvl.filter((l) => l.state === "active" && (l.tx_bps + l.rx_bps) < IDLE_THRESHOLD);
  const totalTx = ib.reduce((s, p) => s + p.tx_bps, 0) + nvl.reduce((s, l) => s + l.tx_bps, 0);
  const totalRx = ib.reduce((s, p) => s + p.rx_bps, 0) + nvl.reduce((s, l) => s + l.rx_bps, 0);
  const isBusy = totalTx + totalRx >= IDLE_THRESHOLD;

  return (
    <div className={`rounded-lg border bg-card/40 p-3 space-y-2 ${isBusy ? "" : "opacity-90"}`}>
      {/* Host header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{host.name}</span>
          {result?.isError && (
            <Badge variant="destructive" className="text-[10px]">unreachable</Badge>
          )}
          {!result?.isError && !data && (
            <Badge variant="secondary" className="text-[10px]">probing…</Badge>
          )}
          {data && !isBusy && (ibBusy.length + nvlBusy.length === 0) && ib.length + nvl.length > 0 && (
            <Badge variant="outline" className="text-[10px] opacity-60">idle</Badge>
          )}
        </div>
        {(totalTx + totalRx) > 0 && (
          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums">
            <span className="flex items-center gap-1 text-blue-500">
              <ArrowUpFromLine className="h-3 w-3" /> {fmtBps(totalTx)}
            </span>
            <span className="flex items-center gap-1 text-emerald">
              <ArrowDownToLine className="h-3 w-3" /> {fmtBps(totalRx)}
            </span>
          </div>
        )}
      </div>

      {/* Busy ports — full split-bar visualisation */}
      {ibBusy.map((p) => (
        <div key={`ib-busy-${p.device}-${p.port}`} className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 min-w-[160px]">
            <Network className="h-3.5 w-3.5 text-amber-500" />
            <span className="font-mono">{p.device}/{p.port}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
              {p.link_layer === "Ethernet" ? "RoCE" : "IB"}·{p.rate_gbps}Gb
            </Badge>
          </div>
          <SplitBar tx={p.tx_bps} rx={p.rx_bps} line={p.rate_gbps} />
          <div className="text-[10px] text-muted-foreground tabular-nums hidden xl:block min-w-[140px] text-right">
            Σ {fmtBytes(p.tx_bytes)}↑ / {fmtBytes(p.rx_bytes)}↓
          </div>
        </div>
      ))}
      {nvlBusy.map((l) => (
        <div key={`nvl-busy-${l.gpu}-${l.link}`} className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 min-w-[160px]">
            <Cable className="h-3.5 w-3.5 text-emerald" />
            <span className="font-mono">GPU{l.gpu}·link{l.link}</span>
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">NVLink</Badge>
          </div>
          <SplitBar tx={l.tx_bps} rx={l.rx_bps} line={50} />
        </div>
      ))}

      {/* Compact line for idle-active ports + DOWN ports */}
      {(ibIdleActive.length + nvlIdleActive.length + ibDown.length) > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-muted-foreground pt-0.5">
          {ibIdleActive.map((p) => (
            <span key={`ib-idle-${p.device}-${p.port}`} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500/70" />
              <span className="font-mono">{p.device}/{p.port}</span>
              <span className="opacity-70">
                {p.link_layer === "Ethernet" ? "RoCE" : "IB"}·{p.rate_gbps}Gb idle
              </span>
            </span>
          ))}
          {nvlIdleActive.map((l) => (
            <span key={`nvl-idle-${l.gpu}-${l.link}`} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald/70" />
              <span className="font-mono">GPU{l.gpu}·link{l.link}</span>
              <span className="opacity-70">NVLink idle</span>
            </span>
          ))}
          {ibDown.map((p) => (
            <span key={`ib-down-${p.device}-${p.port}`} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
              <span className="font-mono opacity-70">{p.device}/{p.port}</span>
              <span className="opacity-60">{p.state}</span>
            </span>
          ))}
        </div>
      )}

      {/* Empty state */}
      {data && ib.length === 0 && nvl.length === 0 && (
        <div className="text-[11px] text-muted-foreground italic">
          No high-speed fabric devices on this host.
        </div>
      )}
    </div>
  );
}

export function FabricActivityPanel({ hosts }: Props) {
  const results = useFabricLive(hosts.map((h) => h.url), 3000);

  // Aggregate fleet totals
  const fleetTx = results.reduce(
    (s, r) =>
      s +
      (r.data?.infiniband ?? []).reduce((a, p) => a + p.tx_bps, 0) +
      (r.data?.nvlink ?? []).reduce((a, l) => a + l.tx_bps, 0),
    0,
  );
  const fleetRx = results.reduce(
    (s, r) =>
      s +
      (r.data?.infiniband ?? []).reduce((a, p) => a + p.rx_bps, 0) +
      (r.data?.nvlink ?? []).reduce((a, l) => a + l.rx_bps, 0),
    0,
  );
  const activeIb = results.reduce(
    (s, r) => s + (r.data?.infiniband ?? []).filter((p) => p.state === "ACTIVE").length,
    0,
  );
  const activeNvl = results.reduce(
    (s, r) => s + (r.data?.nvlink ?? []).filter((l) => l.state === "active").length,
    0,
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-amber-500" />
          Live Fabric Activity
          <Badge variant="secondary" className="text-[10px] ml-1">
            {activeIb} IB / {activeNvl} NVL
          </Badge>
          <div className="ml-auto flex items-center gap-3 text-[11px] font-mono tabular-nums text-muted-foreground">
            <span className="flex items-center gap-1">
              <Wifi className="h-3 w-3" />
              fleet
            </span>
            <span className="flex items-center gap-1 text-blue-500">
              <ArrowUpFromLine className="h-3 w-3" /> {fmtBps(fleetTx)}
            </span>
            <span className="flex items-center gap-1 text-emerald">
              <ArrowDownToLine className="h-3 w-3" /> {fmtBps(fleetRx)}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {hosts.map((h, i) => (
          <HostFabricRow key={h.url} host={h} result={results[i]} />
        ))}
        {hosts.length === 0 && (
          <div className="text-sm text-muted-foreground py-4 text-center">
            Add a host to see fabric activity.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
