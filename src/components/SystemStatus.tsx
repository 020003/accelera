import { useEffect, useState } from "react";
import { proxyUrl } from "@/lib/proxy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Database,
  Activity,
  CheckCircle,
  XCircle,
  RefreshCw,
  Server,
  HardDrive,
  Bot,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface HostHealth {
  url: string;
  status: string;
  hostname: string;
  persistence: {
    enabled: boolean;
    exists: boolean;
    size_bytes: number;
    tables: Record<string, number>;
  };
  features: Record<string, boolean>;
  config: {
    gpu_collect_interval: number;
    data_retention_hours: number;
  };
  error?: string;
  ollama?: { isAvailable: boolean; models: any[] };
  sglang?: { isAvailable: boolean; models: any[] };
}

interface SystemStatusProps {
  hosts: { url: string; name: string }[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function SystemStatus({ hosts }: SystemStatusProps) {
  const [healthData, setHealthData] = useState<Record<string, HostHealth>>({});
  const [loading, setLoading] = useState(false);

  const fetchHealth = async () => {
    setLoading(true);
    const results: Record<string, HostHealth> = {};

    await Promise.allSettled(
      hosts.map(async (host) => {
        try {
          const baseUrl = host.url.replace(/\/nvidia-smi\.json$/, "");
          const res = await fetch(proxyUrl(`${baseUrl}/api/health`), {
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json();
            const entry: HostHealth = { ...data, url: host.url };

            // Probe Ollama
            try {
              const ollamaRes = await fetch(proxyUrl(`${baseUrl}/api/ollama/discover`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostUrl: baseUrl }),
                signal: AbortSignal.timeout(3000),
              });
              if (ollamaRes.ok) {
                const ollamaData = await ollamaRes.json();
                if (ollamaData.isAvailable) entry.ollama = ollamaData;
              }
            } catch {}

            // Probe SGLang
            try {
              const sglangRes = await fetch(proxyUrl(`${baseUrl}/api/sglang/discover`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostUrl: baseUrl }),
                signal: AbortSignal.timeout(3000),
              });
              if (sglangRes.ok) {
                const sglangData = await sglangRes.json();
                if (sglangData.isAvailable) entry.sglang = sglangData;
              }
            } catch {}

            results[host.url] = entry;
          } else {
            results[host.url] = {
              url: host.url,
              status: "error",
              hostname: host.name,
              persistence: { enabled: false, exists: false, size_bytes: 0, tables: {} },
              features: {},
              config: { gpu_collect_interval: 0, data_retention_hours: 0 },
              error: `HTTP ${res.status}`,
            };
          }
        } catch (err: any) {
          results[host.url] = {
            url: host.url,
            status: "error",
            hostname: host.name,
            persistence: { enabled: false, exists: false, size_bytes: 0, tables: {} },
            features: {},
            config: { gpu_collect_interval: 0, data_retention_hours: 0 },
            error: err.message || "Unreachable",
          };
        }
      })
    );

    setHealthData(results);
    setLoading(false);
  };

  useEffect(() => {
    if (hosts.length > 0) {
      fetchHealth();
    }
  }, [hosts.length]);

  if (hosts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Add GPU hosts to see system status.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5" />
          System Status
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchHealth}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {hosts.map((host) => {
        const health = healthData[host.url];
        const isUp = health && health.status === "ok";

        return (
          <Card key={host.url}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center justify-between text-base">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {host.name}
                  <span className="text-xs text-muted-foreground font-normal">
                    {health?.hostname || ""}
                  </span>
                </div>
                {isUp ? (
                  <Badge className="bg-green-500/10 text-green-500 gap-1">
                    <CheckCircle className="h-3 w-3" /> Healthy
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1">
                    <XCircle className="h-3 w-3" /> {health?.error || "Loading..."}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            {isUp && health && (
              <CardContent className="pt-0">
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Persistence Status */}
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <div className="mt-0.5">
                      {health.persistence.exists ? (
                        <Database className="h-4 w-4 text-green-500" />
                      ) : (
                        <HardDrive className="h-4 w-4 text-yellow-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium flex items-center gap-2">
                        Persistence
                        <Badge
                          variant={health.persistence.exists ? "default" : "secondary"}
                          className="text-[10px] h-4"
                        >
                          {health.persistence.exists ? "Active" : "Initializing"}
                        </Badge>
                      </div>
                      {health.persistence.exists ? (
                        <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                          <div>SQLite — {formatBytes(health.persistence.size_bytes)}</div>
                          <div className="flex flex-wrap gap-x-3">
                            {Object.entries(health.persistence.tables).map(([table, count]) => (
                              <span key={table}>
                                {table}: {count >= 0 ? count : "err"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          Database will be created on first data collection
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                    <div className="mt-0.5">
                      <Shield className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <div className="text-sm font-medium">Features</div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {Object.entries(health.features).map(([feat, on]) => (
                          <Badge
                            key={feat}
                            variant={on ? "default" : "secondary"}
                            className="text-[10px] h-4"
                          >
                            {feat.replace(/_/g, " ")}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Collect every {health.config.gpu_collect_interval}s · Retain{" "}
                        {health.config.data_retention_hours}h
                      </div>
                    </div>
                  </div>

                  {/* AI Runtimes */}
                  {(health.ollama?.isAvailable || health.sglang?.isAvailable) && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 md:col-span-2">
                      <div className="mt-0.5">
                        <Bot className="h-4 w-4 text-purple-500" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">AI Runtimes</div>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {health.ollama?.isAvailable && (
                            <Badge variant="secondary" className="gap-1 text-[10px] h-5">
                              <Bot className="h-3 w-3" />
                              Ollama · {health.ollama.models.length} model{health.ollama.models.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                          {health.sglang?.isAvailable && (
                            <Badge variant="secondary" className="gap-1 text-[10px] h-5 bg-cyan-500/10 text-cyan-400">
                              <Sparkles className="h-3 w-3" />
                              SGLang · {health.sglang.models.length} model{health.sglang.models.length !== 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
