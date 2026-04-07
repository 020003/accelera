import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Timer,
  Play,
  Loader2,
  Zap,
  Clock,
  Hash,
  TrendingUp,
  AlertCircle,
  BarChart3,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { proxyUrl } from "@/lib/proxy";

interface BenchmarkResult {
  id: number | null;
  model: string;
  runtime: string;
  prompt: string;
  prompt_tokens: number;
  generated_tokens: number;
  tokens_per_second: number;
  time_to_first_token_ms: number | null;
  total_duration_ms: number;
  status: string;
  error?: string;
  metadata?: {
    max_tokens?: number;
    response_preview?: string;
  };
  created_at?: number;
}

interface Preset {
  label: string;
  max_tokens: number;
}

interface BenchmarkRunnerProps {
  hostUrl: string;
  ollama?: {
    isAvailable: boolean;
    models: any[];
  };
  sglang?: {
    isAvailable: boolean;
    models: any[];
  };
  vllm?: {
    isAvailable: boolean;
    models: any[];
  };
}

interface HostBenchmarkCache {
  selectedModel: string;
  selectedRuntime: "ollama" | "sglang" | "vllm";
  selectedPreset: string;
  running: boolean;
  latestResult: BenchmarkResult | null;
  results: BenchmarkResult[];
  showHistory: boolean;
}

const _stateCache = new Map<string, HostBenchmarkCache>();

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BenchmarkRunner({ hostUrl, ollama, sglang, vllm }: BenchmarkRunnerProps) {
  const cached = _stateCache.get(hostUrl);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [results, setResults] = useState<BenchmarkResult[]>(cached?.results ?? []);
  const [selectedModel, setSelectedModel] = useState(cached?.selectedModel ?? "");
  const [selectedRuntime, setSelectedRuntime] = useState<"ollama" | "sglang" | "vllm">(cached?.selectedRuntime ?? "ollama");
  const [selectedPreset, setSelectedPreset] = useState(cached?.selectedPreset ?? "short");
  const [running, setRunning] = useState(cached?.running ?? false);
  const [latestResult, setLatestResult] = useState<BenchmarkResult | null>(cached?.latestResult ?? null);
  const [showHistory, setShowHistory] = useState(cached?.showHistory ?? false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Sync state to cache on every change
  useEffect(() => {
    _stateCache.set(hostUrl, {
      selectedModel, selectedRuntime, selectedPreset,
      running, latestResult, results, showHistory,
    });
  }, [hostUrl, selectedModel, selectedRuntime, selectedPreset, running, latestResult, results, showHistory]);

  // Derive base URL from hostUrl
  const getBaseUrl = useCallback(() => {
    try {
      const url = new URL(hostUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      return hostUrl.replace(/\/nvidia-smi\.json$/, "");
    }
  }, [hostUrl]);

  // Build available models list – use "runtime:model" as the Select value
  // to guarantee uniqueness even if two runtimes serve the same model name.
  const availableModels: { label: string; value: string; runtime: "ollama" | "sglang" | "vllm" }[] = [];
  if (ollama?.isAvailable && ollama.models.length > 0) {
    ollama.models.forEach((m: any) => {
      const name = m.name || m.model || "unknown";
      availableModels.push({ label: name, value: `ollama:${name}`, runtime: "ollama" });
    });
  }
  if (sglang?.isAvailable && sglang.models.length > 0) {
    sglang.models.forEach((m: any) => {
      const name = m.id || m.name || "unknown";
      availableModels.push({ label: name, value: `sglang:${name}`, runtime: "sglang" });
    });
  }
  if (vllm?.isAvailable && vllm.models.length > 0) {
    vllm.models.forEach((m: any) => {
      const name = m.id || m.name || "unknown";
      availableModels.push({ label: name, value: `vllm:${name}`, runtime: "vllm" });
    });
  }

  // Auto-select first model (only if no cached selection or stale format)
  useEffect(() => {
    const isValid = selectedModel && availableModels.some((m) => m.value === selectedModel);
    if (!isValid && availableModels.length > 0) {
      setSelectedModel(availableModels[0].value);
      setSelectedRuntime(availableModels[0].runtime);
    }
  }, [availableModels.length]);

  // Fetch presets on mount
  useEffect(() => {
    const base = getBaseUrl();
    fetch(proxyUrl(`${base}/api/benchmarks/presets`))
      .then((r) => r.json())
      .then((data) => setPresets(data))
      .catch(() => {
        // Fallback presets if endpoint not available yet
        setPresets({
          short: { label: "Short (3 sentences)", max_tokens: 100 },
          medium: { label: "Medium (comparison)", max_tokens: 512 },
          long: { label: "Long (guide)", max_tokens: 1024 },
        });
      });
  }, [getBaseUrl]);

  // Run benchmark
  const runBenchmark = async () => {
    setRunning(true);
    setLatestResult(null);
    const base = getBaseUrl();

    const modelName = selectedModel.replace(/^(ollama|sglang|vllm):/, "");
    const errorResult = (msg: string): BenchmarkResult => ({
      id: null,
      model: modelName,
      runtime: selectedRuntime,
      prompt: "",
      prompt_tokens: 0,
      generated_tokens: 0,
      tokens_per_second: 0,
      time_to_first_token_ms: null,
      total_duration_ms: 0,
      status: "error",
      error: msg,
    });

    try {
      const resp = await fetch(proxyUrl(`${base}/api/benchmarks/run`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          runtime: selectedRuntime,
          preset: selectedPreset,
        }),
      });
      let data: any;
      try {
        data = await resp.json();
      } catch {
        const result = errorResult(
          resp.status === 504
            ? "Benchmark timed out – try a shorter preset"
            : `Server returned non-JSON response (HTTP ${resp.status})`
        );
        setLatestResult(result);
        setResults((prev) => [result, ...prev]);
        return;
      }

      if (!resp.ok || data.error) {
        const result = errorResult(data.error || `HTTP ${resp.status}`);
        setLatestResult(result);
        setResults((prev) => [result, ...prev]);
        return;
      }

      // Normalise – guarantee every field the UI expects is present
      const result: BenchmarkResult = {
        id: data.id ?? null,
        model: data.model || modelName,
        runtime: data.runtime || selectedRuntime,
        prompt: data.prompt || "",
        prompt_tokens: data.prompt_tokens ?? 0,
        generated_tokens: data.generated_tokens ?? 0,
        tokens_per_second: data.tokens_per_second ?? 0,
        time_to_first_token_ms: data.time_to_first_token_ms ?? null,
        total_duration_ms: data.total_duration_ms ?? 0,
        status: data.status || "completed",
        error: data.error,
        metadata: data.metadata,
        created_at: data.created_at,
      };
      setLatestResult(result);
      setResults((prev) => [result, ...prev]);
    } catch (err) {
      const result = errorResult(err instanceof Error ? err.message : "Network error");
      setLatestResult(result);
    } finally {
      setRunning(false);
    }
  };

  // Load history
  const loadHistory = async () => {
    setLoadingHistory(true);
    const base = getBaseUrl();
    try {
      const resp = await fetch(proxyUrl(`${base}/api/benchmarks/results?limit=20`));
      const data = await resp.json();
      setResults(data);
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [getBaseUrl]);

  if (availableModels.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Timer className="h-8 w-8 mb-3 opacity-30" />
          <p className="text-sm font-medium">No AI Models Available</p>
          <p className="text-xs mt-1">
            Benchmarks require Ollama or SGLang with at least one loaded model.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Run Panel ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Benchmark Runner
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Model selector */}
            <div className="space-y-1.5 min-w-[200px] flex-1">
              <label className="text-xs text-muted-foreground font-medium">Model</label>
              <Select
                value={selectedModel}
                onValueChange={(val) => {
                  setSelectedModel(val);
                  const found = availableModels.find((m) => m.value === val);
                  if (found) setSelectedRuntime(found.runtime);
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      <span className="flex items-center gap-2">
                        {m.label}
                        <Badge variant="secondary" className="text-[9px] h-4 px-1">
                          {m.runtime}
                        </Badge>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Preset selector */}
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-xs text-muted-foreground font-medium">Prompt Preset</label>
              <Select value={selectedPreset} onValueChange={setSelectedPreset}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(presets).map(([key, preset]) => (
                    <SelectItem key={key} value={key}>
                      {preset.label} ({preset.max_tokens} tokens)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Run button */}
            <Button
              onClick={runBenchmark}
              disabled={running || !selectedModel}
              className="h-9 gap-1.5"
              size="sm"
            >
              {running ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {running ? "Running…" : "Run Benchmark"}
            </Button>
          </div>

          {/* Latest result */}
          {latestResult && (
            <div
              className={`rounded-lg border p-4 space-y-3 ${
                latestResult.status === "error"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-emerald-500/30 bg-emerald-500/5"
              }`}
            >
              {latestResult.status === "error" ? (
                <div className="flex items-center gap-2 text-red-500">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">Benchmark failed</span>
                  <span className="text-xs text-muted-foreground">{latestResult.error}</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">
                      {latestResult.model}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {latestResult.runtime}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard
                      icon={TrendingUp}
                      label="Tokens/sec"
                      value={(latestResult.tokens_per_second ?? 0).toFixed(1)}
                      color="text-emerald-500"
                    />
                    <MetricCard
                      icon={Hash}
                      label="Generated"
                      value={`${latestResult.generated_tokens} tok`}
                      color="text-blue-500"
                    />
                    <MetricCard
                      icon={Clock}
                      label="TTFT"
                      value={
                        latestResult.time_to_first_token_ms
                          ? formatDuration(latestResult.time_to_first_token_ms)
                          : "N/A"
                      }
                      color="text-amber-500"
                    />
                    <MetricCard
                      icon={Timer}
                      label="Total Time"
                      value={formatDuration(latestResult.total_duration_ms)}
                      color="text-purple-500"
                    />
                  </div>
                  {latestResult.metadata?.response_preview && (
                    <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-20 overflow-auto font-mono">
                      {latestResult.metadata.response_preview}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── History ── */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <button
              className="flex items-center justify-between w-full"
              onClick={() => setShowHistory((v) => !v)}
            >
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-500" />
                Benchmark History ({results.length})
              </CardTitle>
              {showHistory ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent>
              {loadingHistory ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading history…
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-2 pr-3 font-medium">Model</th>
                        <th className="text-left py-2 pr-3 font-medium">Runtime</th>
                        <th className="text-right py-2 pr-3 font-medium">Tok/s</th>
                        <th className="text-right py-2 pr-3 font-medium">Generated</th>
                        <th className="text-right py-2 pr-3 font-medium">TTFT</th>
                        <th className="text-right py-2 pr-3 font-medium">Duration</th>
                        <th className="text-right py-2 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => (
                        <tr
                          key={r.id ?? i}
                          className={`border-b border-border/30 ${
                            r.status === "error" ? "text-red-400" : ""
                          }`}
                        >
                          <td className="py-2 pr-3 font-medium">{r.model}</td>
                          <td className="py-2 pr-3">
                            <Badge variant="outline" className="text-[9px] h-4 px-1">
                              {r.runtime}
                            </Badge>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {r.status === "error" ? "—" : (r.tokens_per_second ?? 0).toFixed(1)}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {r.status === "error" ? "—" : r.generated_tokens}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {r.time_to_first_token_ms
                              ? formatDuration(r.time_to_first_token_ms)
                              : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono">
                            {r.status === "error" ? "—" : formatDuration(r.total_duration_ms)}
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {r.created_at ? formatDate(r.created_at) : "just now"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${color}`} />
      <div>
        <div className="text-[10px] text-muted-foreground leading-none">{label}</div>
        <div className="text-sm font-bold font-mono leading-tight">{value}</div>
      </div>
    </div>
  );
}
