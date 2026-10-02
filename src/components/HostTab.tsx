import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GpuCard } from "./GpuCard";
import { TokenStatsCard } from "./TokenStatsCard";
import { BenchmarkRunner } from "./BenchmarkRunner";
import { ProcessInspector } from "./ProcessInspector";
import { VllmOperationsPanel } from "./VllmOperationsPanel";
import { useLLMStatus, useTokenStats } from "@/hooks/useTokenStats";
import {
  Server,
  AlertTriangle,
  RefreshCw,
  Wifi,
  WifiOff,
  Bot,
  Brain,
  Cpu,
  Activity,
  HardDrive,
  Thermometer,
  Zap,
  Sparkles,
  Timer,
  Terminal,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { GpuInfo } from "@/types/gpu";
import type { HostData, RuntimeModel } from "@/types/dashboard";

interface HostTabProps {
  hostName: string;
  hostUrl: string;
  gpus: GpuInfo[];
  isConnected: boolean;
  isFetching: boolean;
  error?: string;
  timestamp?: string;
  snapshotSource?: string;
  stale?: boolean;
  fetchedAt?: number;
  lastSuccessAt?: number;
  fetchDurationMs?: number;
  cacheAgeSeconds?: number;
  energyRate: number;
  currencySymbol?: string;
  onRefresh: () => void;
  ollama?: HostData["ollama"];
  sglang?: HostData["sglang"];
  vllm?: HostData["vllm"];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatEpochTime(epochSeconds?: number): string | undefined {
  if (!epochSeconds) return undefined;
  return new Date(epochSeconds * 1000).toLocaleTimeString();
}

function snapshotLabel(source?: string, stale?: boolean): string {
  if (stale) return "Stale";
  if (source === "cache") return "Cached";
  if (source === "live") return "Live";
  if (source === "stale-cache") return "Stale";
  return "Snapshot";
}

function modelLabel(model: RuntimeModel): string {
  return model.name || model.id || "Unknown model";
}

export function HostTab({
  hostName,
  hostUrl,
  gpus,
  isConnected,
  isFetching,
  error,
  timestamp,
  snapshotSource,
  stale,
  fetchedAt,
  lastSuccessAt,
  fetchDurationMs,
  cacheAgeSeconds,
  energyRate,
  currencySymbol = "$",
  onRefresh,
  ollama,
  sglang,
  vllm,
}: HostTabProps) {
  const [tokenHours, setTokenHours] = useState(24);
  const { data: tokenStats, isLoading: tokenLoading } = useTokenStats(hostUrl, tokenHours);
  const { data: llmStatus } = useLLMStatus(hostUrl, Boolean(vllm?.isAvailable));

  // Compute aggregate GPU stats
  const totalGpus = gpus.length;
  const avgUtil =
    totalGpus > 0
      ? Math.round(gpus.reduce((s, g) => s + g.utilization, 0) / totalGpus)
      : 0;
  const avgTemp =
    totalGpus > 0
      ? Math.round(gpus.reduce((s, g) => s + g.temperature, 0) / totalGpus)
      : 0;
  const totalPower = gpus.reduce((s, g) => s + g.power.draw, 0);
  const memUsed = gpus.reduce((s, g) => s + g.memory.used, 0);
  const memTotal = gpus.reduce((s, g) => s + g.memory.total, 0);
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;
  const snapshotTime = formatEpochTime(fetchedAt);
  const lastSuccessTime = formatEpochTime(lastSuccessAt);
  const snapshotClassName = stale || snapshotSource === "stale-cache"
    ? "text-[10px] h-5 gap-1 bg-amber-500/10 text-amber-500 border-amber-500/30"
    : snapshotSource === "cache"
      ? "text-[10px] h-5 gap-1 bg-blue-500/10 text-blue-500 border-blue-500/30"
      : "text-[10px] h-5 gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/30";

  return (
    <div className="space-y-5">
      {/* ── Compact Header ── */}
      <div className="surface-panel flex flex-col gap-4 rounded-2xl border p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="p-2 bg-emerald/10 rounded-lg">
            <Server className="h-5 w-5 text-emerald" />
          </div>
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {hostName}
              <Badge
                variant={isConnected ? "default" : "secondary"}
                className="text-[10px] h-5"
              >
                {isConnected ? (
                  <Wifi className="h-3 w-3 mr-1" />
                ) : (
                  <WifiOff className="h-3 w-3 mr-1" />
                )}
                {isConnected ? "Online" : "Offline"}
              </Badge>
              {ollama?.isAvailable && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                  <Bot className="h-3 w-3" />
                  Ollama · {ollama.models.length} models
                </Badge>
              )}
              {sglang?.isAvailable && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1 bg-cyan-500/10 text-cyan-400">
                  <Sparkles className="h-3 w-3" />
                  SGLang · {sglang.models.length} models
                </Badge>
              )}
              {vllm?.isAvailable && (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1 bg-orange-500/10 text-orange-400">
                  <Zap className="h-3 w-3" />
                  vLLM · {vllm.models.length} models
                </Badge>
              )}
              {snapshotSource && (
                <Badge variant="outline" className={snapshotClassName}>
                  <Timer className="h-3 w-3" />
                  {snapshotLabel(snapshotSource, stale)}
                  {typeof fetchDurationMs === "number" && ` · ${fetchDurationMs}ms`}
                </Badge>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{hostUrl}</span>
              {snapshotTime && <span>Snapshot {snapshotTime}</span>}
              {lastSuccessTime && <span>Last OK {lastSuccessTime}</span>}
              {typeof cacheAgeSeconds === "number" && snapshotSource === "cache" && (
                <span>Cache age {cacheAgeSeconds.toFixed(1)}s</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3">
          {timestamp && isConnected && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isFetching}
            className="h-8"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Connected content ── */}
      {isConnected && gpus.length > 0 ? (
        <>
          {/* Quick-stat ribbon */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              {
                label: "GPUs",
                value: totalGpus,
                icon: Cpu,
                color: "text-emerald-500",
                bg: "bg-emerald-500/10",
              },
              {
                label: "Avg Util",
                value: `${avgUtil}%`,
                icon: Activity,
                color:
                  avgUtil >= 80 ? "text-amber-500" : "text-blue-500",
                bg:
                  avgUtil >= 80 ? "bg-amber-500/10" : "bg-blue-500/10",
              },
              {
                label: "VRAM",
                value: `${memPct}%`,
                icon: HardDrive,
                color:
                  memPct >= 80 ? "text-red-500" : "text-purple-500",
                bg:
                  memPct >= 80 ? "bg-red-500/10" : "bg-purple-500/10",
                sub: `${Math.round(memUsed / 1024)}/${Math.round(memTotal / 1024)} GB`,
              },
              {
                label: "Avg Temp",
                value: `${avgTemp}°C`,
                icon: Thermometer,
                color:
                  avgTemp >= 80
                    ? "text-red-500"
                    : avgTemp >= 70
                    ? "text-amber-500"
                    : "text-emerald-500",
                bg:
                  avgTemp >= 80
                    ? "bg-red-500/10"
                    : avgTemp >= 70
                    ? "bg-amber-500/10"
                    : "bg-emerald-500/10",
              },
              {
                label: "Power",
                value: `${Math.round(totalPower)}W`,
                icon: Zap,
                color: "text-amber-500",
                bg: "bg-amber-500/10",
              },
              ...((ollama?.isAvailable || sglang?.isAvailable || vllm?.isAvailable)
                ? [
                    {
                      label: "AI Models",
                      value: (ollama?.models.length || 0) + (sglang?.models.length || 0) + (vllm?.models.length || 0),
                      icon: Brain,
                      color: "text-purple-500",
                      bg: "bg-purple-500/10",
                      sub: [
                        ollama?.isAvailable ? `${ollama.models.length} Ollama` : "",
                        sglang?.isAvailable ? `${sglang.models.length} SGLang` : "",
                        vllm?.isAvailable ? `${vllm.models.length} vLLM` : "",
                      ].filter(Boolean).join(" + "),
                    },
                  ]
                : []),
            ].map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="shadow-none border-border/50">
                  <CardContent className="p-3 flex items-center gap-2.5">
                    <div className={`p-1.5 rounded-md ${stat.bg}`}>
                      <Icon className={`h-4 w-4 ${stat.color}`} />
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground leading-none">
                        {stat.label}
                      </div>
                      <div className="text-base font-bold font-mono leading-tight">
                        {stat.value}
                      </div>
                      {"sub" in stat && stat.sub && (
                        <div className="text-[10px] text-muted-foreground">
                          {stat.sub}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Tabbed content */}
          <Tabs defaultValue="gpus" className="space-y-4">
            <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-xl p-1.5">
              <TabsTrigger value="gpus" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                <Cpu className="h-3.5 w-3.5" />
                GPUs ({gpus.length})
              </TabsTrigger>
              <TabsTrigger value="tokens" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Token Usage
              </TabsTrigger>
              {ollama?.isAvailable && (
                <TabsTrigger value="ollama" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                  <Bot className="h-3.5 w-3.5" />
                  Ollama ({ollama.models.length})
                </TabsTrigger>
              )}
              {sglang?.isAvailable && (
                <TabsTrigger value="sglang" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                  <Sparkles className="h-3.5 w-3.5" />
                  SGLang ({sglang.models.length})
                </TabsTrigger>
              )}
              {vllm?.isAvailable && (
                <TabsTrigger value="vllm" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                  <Zap className="h-3.5 w-3.5" />
                  vLLM ({vllm.models.length})
                </TabsTrigger>
              )}
              <TabsTrigger value="processes" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                <Terminal className="h-3.5 w-3.5" />
                Processes
              </TabsTrigger>
              {(ollama?.isAvailable || sglang?.isAvailable || vllm?.isAvailable) && (
                <TabsTrigger value="benchmark" className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-xs">
                  <Timer className="h-3.5 w-3.5" />
                  Benchmark
                </TabsTrigger>
              )}
            </TabsList>

            {/* GPU cards */}
            <TabsContent value="gpus">
              <div className="grid gap-4 lg:grid-cols-2">
                {gpus.map((gpu) => (
                  <div key={gpu.uuid || gpu.id} className="animate-fade-in">
                    <GpuCard gpu={gpu} energyRate={energyRate} currencySymbol={currencySymbol} />
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* Token stats */}
            <TabsContent value="tokens" className="space-y-3">
              <div className="flex justify-end">
                <ToggleGroup
                  type="single"
                  value={String(tokenHours)}
                  onValueChange={(v) => v && setTokenHours(Number(v))}
                  className="h-7"
                >
                  {[1, 6, 12, 24, 72, 168].map((h) => (
                    <ToggleGroupItem
                      key={h}
                      value={String(h)}
                      className="text-xs px-2.5 h-7"
                    >
                      {h <= 24 ? `${h}h` : `${h / 24}d`}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              {tokenStats ? (
                <TokenStatsCard stats={tokenStats} llmStatus={llmStatus} isLoading={tokenLoading} hours={tokenHours} />
              ) : tokenLoading ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    Loading token statistics…
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground text-sm">
                    Token statistics are not available for this host.
                    <br />
                    <span className="text-xs">
                      Ensure the exporter can reach the configured Ollama, SGLang, or vLLM metrics endpoint.
                    </span>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Ollama models */}
            {ollama?.isAvailable && (
              <TabsContent value="ollama">
                {ollama.models.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Brain className="h-10 w-10 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">No Models Found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        No AI models are currently available on this Ollama
                        instance.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {ollama.models.map((model) => (
                      <Card
                        key={modelLabel(model)}
                        className="shadow-none border-border/50"
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="p-2 rounded-md bg-purple-500/10">
                            <Brain className="h-4 w-4 text-purple-500" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {modelLabel(model)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatBytes(model.size || 0)}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}

            <TabsContent value="processes" forceMount className="data-[state=inactive]:hidden">
              <ProcessInspector hostUrl={hostUrl} />
            </TabsContent>

            {(ollama?.isAvailable || sglang?.isAvailable || vllm?.isAvailable) && (
              <TabsContent value="benchmark" forceMount className="data-[state=inactive]:hidden">
                <BenchmarkRunner
                  hostUrl={hostUrl}
                  ollama={ollama}
                  sglang={sglang}
                  vllm={vllm}
                />
              </TabsContent>
            )}

            {vllm?.isAvailable && (
              <TabsContent value="vllm" forceMount className="data-[state=inactive]:hidden">
                <VllmOperationsPanel status={llmStatus} discovery={vllm} />
              </TabsContent>
            )}

            {sglang?.isAvailable && (
              <TabsContent value="sglang">
                {sglang.models.length === 0 ? (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <Sparkles className="h-10 w-10 text-muted-foreground mb-3" />
                      <p className="text-sm font-medium">No Models Loaded</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        No models are currently loaded in SGLang Runtime.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    {sglang.models.map((model) => (
                      <Card
                        key={modelLabel(model)}
                        className="shadow-none border-border/50"
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="p-2 rounded-md bg-cyan-500/10">
                            <Sparkles className="h-4 w-4 text-cyan-500" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {modelLabel(model)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {model.owned_by || "sglang"}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            )}
          </Tabs>
        </>
      ) : (
        /* ── Disconnected / no data ── */
        <div className="flex flex-col items-center justify-center py-16 space-y-4">
          <div className="p-4 bg-muted/50 rounded-full">
            <AlertTriangle className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-medium">
              {isConnected ? "No GPU Data Available" : "Connection Failed"}
            </h3>
            <p className="text-muted-foreground max-w-md text-sm">
              {isConnected
                ? "This host is connected but no GPU data was found. Make sure NVIDIA drivers are installed."
                : error ||
                  "Could not connect to this host. Check the URL and ensure the API is running."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}