import { useEffect, useMemo, useState } from "react";
import { Activity, Copy, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { FabricSnapshot, IBPort } from "@/hooks/useFabricLive";

interface Props {
  hostName?: string;
  hostUrl?: string;
  snapshot?: FabricSnapshot;
  onClose: () => void;
}

function formatRate(bytesPerSecond: number | null | undefined): string {
  const value = bytesPerSecond || 0;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB/s`;
  return `${Math.round(value)} B/s`;
}

function copy(value: string) {
  navigator.clipboard?.writeText(value);
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 border-b py-2 text-xs last:border-0"><span className="text-muted-foreground">{label}</span><span className="font-mono text-right">{value}</span></div>;
}

export function InfiniBandInspector({ hostName, hostUrl, snapshot, onClose }: Props) {
  const ports = snapshot?.infiniband || [];
  const [portKey, setPortKey] = useState<string>();
  const selected = useMemo(() => {
    const active = ports.filter((port) => port.state === "ACTIVE");
    const candidates = active.length ? active : ports;
    return candidates.find((port) => `${port.device}/${port.port}` === portKey) || candidates[0];
  }, [portKey, ports]);

  useEffect(() => setPortKey(undefined), [hostUrl]);

  if (!hostUrl) {
    return <Card className="h-fit"><CardHeader><CardTitle className="text-base">InfiniBand inspector</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">Select a host node or fabric link to inspect its ports, GIDs, P_Keys, health, and live counters.</CardContent></Card>;
  }

  if (!snapshot || !selected) {
    return <Card className="h-fit"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">{hostName || hostUrl}</CardTitle><Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button></CardHeader><CardContent className="text-sm text-muted-foreground">No InfiniBand or RoCE port metadata is currently available for this host.</CardContent></Card>;
  }

  const isRoce = selected.link_layer === "Ethernet";
  return <Card className="h-fit"><CardHeader className="space-y-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{hostName || hostUrl}</CardTitle><p className="font-mono text-xs text-muted-foreground">{hostUrl}</p></div><Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}><X className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-2">{ports.map((port) => <Button key={`${port.device}/${port.port}`} size="sm" variant={`${port.device}/${port.port}` === `${selected.device}/${selected.port}` ? "secondary" : "ghost"} className="h-7 text-xs" onClick={() => setPortKey(`${port.device}/${port.port}`)}>{port.device}/{port.port}</Button>)}</div></CardHeader><CardContent className="space-y-5"><section><div className="mb-2 flex items-center gap-2"><Network className="h-4 w-4 text-violet-400" /><h4 className="text-sm font-semibold">Link health</h4><Badge variant={selected.state === "ACTIVE" ? "secondary" : "destructive"}>{selected.state}</Badge></div><KeyValue label="Physical state" value={selected.physical_state} /><KeyValue label="Layer" value={isRoce ? "RoCE / Ethernet" : "InfiniBand"} /><KeyValue label="Rate" value={`${selected.rate_gbps} Gb/s`} /><KeyValue label="Netdev" value={selected.netdev || "N/A"} /><KeyValue label="Counter source" value={selected.counter_source} /><KeyValue label="LID" value={isRoce && selected.lid === "0x0" ? "N/A for RoCE" : selected.lid} /><KeyValue label="SM LID" value={isRoce && selected.sm_lid === "0x0" ? "N/A for RoCE" : selected.sm_lid} /></section><section><div className="mb-2 flex items-center gap-2"><Activity className="h-4 w-4 text-cyan-400" /><h4 className="text-sm font-semibold">Live traffic</h4></div><KeyValue label="TX / RX" value={`${formatRate(selected.tx_bps)} / ${formatRate(selected.rx_bps)}`} /><KeyValue label="RDMA TX / RX" value={`${formatRate(selected.rdma_tx_bps)} / ${formatRate(selected.rdma_rx_bps)}`} /><KeyValue label="Link downed" value={String(selected.errors.link_downed)} /><KeyValue label="Symbol errors" value={String(selected.errors.symbol_errors)} /></section><section><h4 className="mb-2 text-sm font-semibold">GIDs</h4><div className="space-y-1">{selected.gids.length ? selected.gids.map((gid, index) => <button key={gid} onClick={() => copy(gid)} className="flex w-full items-center justify-between rounded bg-muted px-2 py-1.5 font-mono text-[11px] hover:bg-muted/70"><span>{index}: {gid}</span><Copy className="h-3 w-3" /></button>) : <p className="text-xs text-muted-foreground">No nonzero GIDs reported.</p>}</div></section><section><h4 className="mb-2 text-sm font-semibold">P_Keys</h4><div className="flex flex-wrap gap-1.5">{selected.pkeys.length ? selected.pkeys.map((pkey, index) => <button key={pkey} onClick={() => copy(pkey)} className="rounded bg-muted px-2 py-1 font-mono text-xs hover:bg-muted/70">{index}: {pkey}</button>) : <p className="text-xs text-muted-foreground">No nonzero P_Keys reported.</p>}</div></section></CardContent></Card>;
}
