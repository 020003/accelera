import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Terminal,
  Cpu,
  Brain,
  HardDrive,
  RefreshCw,
  Loader2,
  Clock,
  User,
  Activity,
  Box,
} from "lucide-react";
import { proxyUrl } from "@/lib/proxy";

interface GpuProcess {
  pid: number;
  name: string;
  cmdline: string;
  user: string;
  gpuId: number;
  gpuName: string;
  memory: number;
  memoryPercent: number;
  category: "ai" | "system" | "other";
  runtime: string;
  model: string;
  uptime: string;
  uptimeSeconds: number;
  cpuPercent: number;
}

interface GpuSummary {
  id: number;
  name: string;
  memoryTotal: number;
  memoryUsed: number;
  processCount: number;
  processMemory: number;
}

interface ProcessData {
  processes: GpuProcess[];
  gpus: GpuSummary[];
  summary: {
    totalProcesses: number;
    aiProcesses: number;
    systemProcesses: number;
    otherProcesses: number;
    totalProcessMemoryMiB: number;
  };
}

interface ProcessInspectorProps {
  hostUrl: string;
}

function fmtMem(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MiB`;
}

const _cache = new Map<string, { data: ProcessData; ts: number }>();

export function ProcessInspector({ hostUrl }: ProcessInspectorProps) {
  const cached = _cache.get(hostUrl);
  const [data, setData] = useState<ProcessData | null>(cached?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getBaseUrl = useCallback(() => {
    try {
      const url = new URL(hostUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return hostUrl.replace(/\/nvidia-smi\.json$/, "");
    }
  }, [hostUrl]);

  const fetchProcesses = useCallback(async () => {
    setLoading(true);
    setError(null);
    const base = getBaseUrl();
    try {
      const resp = await fetch(proxyUrl(`${base}/api/gpu/processes`));
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result: ProcessData = await resp.json();
      setData(result);
      _cache.set(hostUrl, { data: result, ts: Date.now() });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [getBaseUrl, hostUrl]);

  // Auto-poll every 10 seconds
  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(fetchProcesses, 10_000);
    return () => clearInterval(interval);
  }, [fetchProcesses]);

  if (!data && loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12 text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading processes…
        </CardContent>
      </Card>
    );
  }

  if (!data && error) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Terminal className="h-8 w-8 mb-3 opacity-30" />
          <p className="text-sm font-medium">Failed to load processes</p>
          <p className="text-xs mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={fetchProcesses}>
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { summary, gpus, processes } = data;

  return (
    <div className="space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {summary.totalProcesses} process{summary.totalProcesses !== 1 ? "es" : ""} across {gpus.length} GPU{gpus.length !== 1 ? "s" : ""}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={fetchProcesses}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Per-GPU memory bars */}
      <div className="grid gap-3">
        {gpus.map((gpu) => {
          const procPct = gpu.memoryTotal > 0 ? (gpu.processMemory / gpu.memoryTotal) * 100 : 0;
          const usedPct = gpu.memoryTotal > 0 ? (gpu.memoryUsed / gpu.memoryTotal) * 100 : 0;
          const gpuProcs = processes.filter((p) => p.gpuId === gpu.id);

          return (
            <Card key={gpu.id} className="shadow-none border-border/50">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-emerald-500/10">
                      <Cpu className={`h-3.5 w-3.5 ${gpuProcs.length > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                    </div>
                    <div>
                      <div className="text-sm font-medium">GPU {gpu.id}</div>
                      <div className="text-[11px] text-muted-foreground">{gpu.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold font-mono">{fmtMem(gpu.processMemory)}</div>
                    <div className="text-[11px] text-muted-foreground">of {fmtMem(gpu.memoryTotal)}</div>
                  </div>
                </div>

                {/* VRAM bar */}
                <div className="h-2.5 bg-muted rounded-full overflow-hidden flex">
                  <div
                    className="bg-purple-500 rounded-l-full transition-all duration-300"
                    style={{ width: `${Math.min(procPct, 100)}%` }}
                  />
                  <div
                    className="bg-blue-500/30 transition-all duration-300"
                    style={{ width: `${Math.min(Math.max(usedPct - procPct, 0), 100)}%` }}
                  />
                </div>

                {/* Process cards for this GPU */}
                {gpuProcs.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    {gpuProcs.map((p) => (
                      <ProcessCard key={p.pid} process={p} gpuMemTotal={gpu.memoryTotal} />
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    No active processes
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground justify-center">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-500" /> Process VRAM</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500/30" /> Other VRAM</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-muted" /> Free</span>
      </div>
    </div>
  );
}

function ProcessCard({ process: p, gpuMemTotal }: { process: GpuProcess; gpuMemTotal: number }) {
  const isAi = p.category === "ai";

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${isAi ? "border-purple-500/20 bg-purple-500/[0.03]" : "border-border/50"}`}>
      {/* Top row: name + badges */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate">{p.name}</span>
            {p.runtime && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                {p.runtime}
              </Badge>
            )}
            {isAi && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 bg-purple-500/10 text-purple-400 shrink-0">
                <Brain className="h-2.5 w-2.5 mr-0.5" />
                AI
              </Badge>
            )}
          </div>
          {p.model && (
            <div className="flex items-center gap-1 mt-1">
              <Box className="h-3 w-3 text-purple-400 shrink-0" />
              <span className="text-xs font-medium text-purple-400 truncate">{p.model}</span>
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold font-mono">{fmtMem(p.memory)}</div>
          <div className="text-[10px] text-muted-foreground">{p.memoryPercent}% VRAM</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1 font-mono">
          <Terminal className="h-3 w-3" />
          PID {p.pid}
        </span>
        {p.user && (
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {p.user}
          </span>
        )}
        {p.uptime && p.uptime !== "0s" && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {p.uptime}
          </span>
        )}
        {p.cpuPercent > 0 && (
          <span className="flex items-center gap-1">
            <Activity className="h-3 w-3" />
            {p.cpuPercent}% CPU
          </span>
        )}
      </div>

      {/* VRAM usage bar for this process */}
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${isAi ? "bg-purple-500" : "bg-blue-500"}`}
          style={{ width: `${Math.min(p.memoryPercent, 100)}%` }}
        />
      </div>

      {/* Command line */}
      {p.cmdline && (
        <div className="text-[10px] font-mono text-muted-foreground/70 break-all leading-relaxed bg-muted/30 rounded px-2 py-1.5 max-h-16 overflow-auto">
          {p.cmdline}
        </div>
      )}
    </div>
  );
}
