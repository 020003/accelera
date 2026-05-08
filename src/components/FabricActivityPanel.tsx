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

function PortBar({ tx, rx, line }: { tx: number; rx: number; line: number }) {
  const utx = utilization(tx, line) * 100;
  const urx = utilization(rx, line) * 100;
  return (
    <div className="space-y-1 min-w-[140px]">
      <div className="flex items-center gap-1.5 text-[11px]">
        <ArrowUpFromLine className="h-3 w-3 text-blue-500" />
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${utx}%` }}
          />
        </div>
        <span className="font-mono tabular-nums w-[68px] text-right text-blue-500">
          {fmtBps(tx)}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[11px]">
        <ArrowDownToLine className="h-3 w-3 text-emerald-500" />
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${urx}%` }}
          />
        </div>
        <span className="font-mono tabular-nums w-[68px] text-right text-emerald-500">
          {fmtBps(rx)}
        </span>
      </div>
    </div>
  );
}

function HostFabricRow({ host, result }: { host: Host; result?: FabricResult }) {
  const data = result?.data;
  const ibActive = (data?.infiniband ?? []).filter((p) => p.state === "ACTIVE");
  const ibIdle = (data?.infiniband ?? []).filter((p) => p.state !== "ACTIVE");
  const nvlActive = (data?.nvlink ?? []).filter((l) => l.state === "active");
  const totalTx = (data?.infiniband ?? []).reduce((s, p) => s + p.tx_bps, 0)
                + (data?.nvlink ?? []).reduce((s, l) => s + l.tx_bps, 0);
  const totalRx = (data?.infiniband ?? []).reduce((s, p) => s + p.rx_bps, 0)
                + (data?.nvlink ?? []).reduce((s, l) => s + l.rx_bps, 0);

  return (
    <div className="rounded-lg border bg-card/40 p-3 space-y-2.5">
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
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono tabular-nums">
          <span className="flex items-center gap-1">
            <ArrowUpFromLine className="h-3 w-3 text-blue-500" />
            {fmtBps(totalTx)}
          </span>
          <span className="flex items-center gap-1">
            <ArrowDownToLine className="h-3 w-3 text-emerald-500" />
            {fmtBps(totalRx)}
          </span>
        </div>
      </div>

      {/* InfiniBand / RoCE ports */}
      {(ibActive.length > 0 || ibIdle.length > 0) && (
        <div className="space-y-1.5">
          {ibActive.map((p) => (
            <div key={`ib-${p.device}-${p.port}`} className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 min-w-[150px]">
                <Network className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-mono">{p.device}/{p.port}</span>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                  {p.link_layer === "Ethernet" ? "RoCE" : "IB"} · {p.rate_gbps}Gb
                </Badge>
              </div>
              <div className="flex-1">
                <PortBar tx={p.tx_bps} rx={p.rx_bps} line={p.rate_gbps} />
              </div>
              <div className="text-[10px] text-muted-foreground tabular-nums hidden lg:block min-w-[120px] text-right">
                Σ {fmtBytes(p.tx_bytes)}↑ / {fmtBytes(p.rx_bytes)}↓
              </div>
            </div>
          ))}
          {ibIdle.map((p) => (
            <div key={`ib-${p.device}-${p.port}`} className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Network className="h-3 w-3" />
              <span className="font-mono">{p.device}/{p.port}</span>
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4 opacity-60">
                {p.state}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {/* NVLinks */}
      {nvlActive.length > 0 && (
        <div className="space-y-1.5">
          {nvlActive.map((l) => (
            <div key={`nvl-${l.gpu}-${l.link}`} className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 min-w-[150px]">
                <Cable className="h-3.5 w-3.5 text-emerald-500" />
                <span className="font-mono">GPU{l.gpu} · link {l.link}</span>
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">NVLink</Badge>
              </div>
              <div className="flex-1">
                <PortBar tx={l.tx_bps} rx={l.rx_bps} line={50 /* per-link assumption */} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {data && ibActive.length === 0 && ibIdle.length === 0 && nvlActive.length === 0 && (
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
            <span className="flex items-center gap-1 text-emerald-500">
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
