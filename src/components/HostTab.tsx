import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GpuCard } from "./GpuCard";
import { TokenStatsCard } from "./TokenStatsCard";
import { useTokenStats } from "@/hooks/useTokenStats";
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
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { GpuInfo } from "@/types/gpu";

interface HostTabProps {
  hostName: string;
  hostUrl: string;
  gpus: GpuInfo[];
  isConnected: boolean;
  isFetching: boolean;
  error?: string;
  timestamp?: string;
  energyRate: number;
  onRefresh: () => void;
  ollama?: {
    isAvailable: boolean;
    models: any[];
    performanceMetrics: any;
    recentRequests: any[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function HostTab({
  hostName,
  hostUrl,
  gpus,
  isConnected,
  isFetching,
  error,
  timestamp,
  energyRate,
  onRefresh,
  ollama,
}: HostTabProps) {
  const [tokenHours, setTokenHours] = useState(24);
  const { data: tokenStats, isLoading: tokenLoading } = useTokenStats(hostUrl, tokenHours);

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

  return (
    <div className="space-y-5">
      {/* ── Compact Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald/10 rounded-lg">
            <Server className="h-5 w-5 text-emerald" />
          </div>
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
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
            </h2>
            <p className="text-xs text-muted-foreground">{hostUrl}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
              ...(ollama?.isAvailable
                ? [
                    {
                      label: "AI Models",
                      value: ollama.models.length,
                      icon: Brain,
                      color: "text-purple-500",
                      bg: "bg-purple-500/10",
                      sub: formatBytes(
                        ollama.models.reduce(
                          (s: number, m: any) => s + m.size,
                          0
                        )
                      ),
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
            <TabsList>
              <TabsTrigger value="gpus" className="gap-1.5 text-xs">
                <Cpu className="h-3.5 w-3.5" />
                GPUs ({gpus.length})
              </TabsTrigger>
              <TabsTrigger value="tokens" className="gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" />
                Token Usage
              </TabsTrigger>
              {ollama?.isAvailable && (
                <TabsTrigger value="ollama" className="gap-1.5 text-xs">
                  <Bot className="h-3.5 w-3.5" />
                  AI Models ({ollama.models.length})
                </TabsTrigger>
              )}
            </TabsList>

            {/* GPU cards */}
            <TabsContent value="gpus">
              <div className="grid gap-4 lg:grid-cols-2">
                {gpus.map((gpu) => (
                  <div key={gpu.uuid || gpu.id} className="animate-fade-in">
                    <GpuCard gpu={gpu} energyRate={energyRate} />
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
                <TokenStatsCard stats={tokenStats} isLoading={tokenLoading} />
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
                      Ensure the exporter can reach Ollama on localhost:11434.
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
                    {ollama.models.map((model: any) => (
                      <Card
                        key={model.name}
                        className="shadow-none border-border/50"
                      >
                        <CardContent className="p-4 flex items-center gap-3">
                          <div className="p-2 rounded-md bg-purple-500/10">
                            <Brain className="h-4 w-4 text-purple-500" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">
                              {model.name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {formatBytes(model.size)}
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