import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Users,
  type LucideIcon,
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

interface MixedPrompt {
  name: string;
  prompt: string;
  weight: number;
  max_tokens: number;
}

interface MixedLoadResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  workload: string;
  tokensPerSecond: number;
  generatedTokens: number;
  timeToFirstTokenMs: number | null;
  error?: string;
}

interface MixedLoadSummary {
  requests: number;
  successful: number;
  failed: number;
  elapsedMs: number;
  requestsPerSecond: number;
  latencyMs: {
    min: number;
    mean: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
  };
  tokensPerSecond: {
    mean: number;
    p50: number;
  };
  byWorkload: Record<string, { count: number; ok: number; errors: number }>;
  errors: { statusCode: number | null; workload: string; error?: string }[];
}

interface RuntimeModel {
  id?: string;
  name?: string;
  model?: string;
}

interface BenchmarkRunnerProps {
  hostUrl: string;
  ollama?: {
    isAvailable: boolean;
    models: RuntimeModel[];
  };
  sglang?: {
    isAvailable: boolean;
    models: RuntimeModel[];
  };
  vllm?: {
    isAvailable: boolean;
    models: RuntimeModel[];
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

const DEFAULT_MIXED_PROMPTS: MixedPrompt[] = [
  {
    name: "short_chat",
    weight: 30,
    max_tokens: 64,
    prompt: "In two sentences, explain why GPU memory bandwidth matters for LLM inference.",
  },
  {
    name: "technical_explain",
    weight: 20,
    max_tokens: 128,
    prompt: "Explain tensor parallelism to an ML engineer who understands CUDA but is new to distributed inference.",
  },
  {
    name: "summarize",
    weight: 15,
    max_tokens: 96,
    prompt: "Summarize a GPU utilization incident for an executive audience, including root cause and next action.",
  },
  {
    name: "code_help",
    weight: 15,
    max_tokens: 160,
    prompt: "Write a Python function that computes p50, p95, and p99 latency from millisecond measurements.",
  },
  {
    name: "json_extraction",
    weight: 10,
    max_tokens: 96,
    prompt: "Return JSON with keys risk, root_cause, next_action for benchmark requests timing out under mixed load.",
  },
  {
    name: "long_reasoning",
    weight: 10,
    max_tokens: 256,
    prompt: "Compare throughput, latency, and fairness tradeoffs when serving short chat and long code prompts together.",
  },
];

const DEFAULT_MIXED_PROMPT_TEXT = DEFAULT_MIXED_PROMPTS.map((prompt) => JSON.stringify(prompt)).join("\n");

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

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((pct / 100) * (sorted.length - 1))));
  return sorted[index];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parseMixedPrompts(value: string): MixedPrompt[] {
  const prompts = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as Partial<MixedPrompt>;
      const prompt = String(parsed.prompt || "").trim();
      if (!prompt) throw new Error(`Prompt line ${index + 1} is missing prompt`);
      return {
        name: String(parsed.name || `prompt_${index + 1}`),
        prompt,
        weight: clampNumber(Number(parsed.weight ?? 1), 1, 100),
        max_tokens: clampNumber(Number(parsed.max_tokens ?? 128), 16, 1024),
      };
    });
  if (prompts.length === 0) throw new Error("Add at least one prompt line");
  return prompts;
}

function pickWeightedPrompt(prompts: MixedPrompt[]): MixedPrompt {
  const totalWeight = prompts.reduce((sum, prompt) => sum + prompt.weight, 0);
  let cursor = Math.random() * totalWeight;
  for (const prompt of prompts) {
    cursor -= prompt.weight;
    if (cursor <= 0) return prompt;
  }
  return prompts[prompts.length - 1];
}

function summarizeMixedLoad(results: MixedLoadResult[], elapsedMs: number): MixedLoadSummary {
  const latencies = results.map((result) => result.latencyMs);
  const successful = results.filter((result) => result.ok);
  const tps = successful.map((result) => result.tokensPerSecond).filter((value) => value > 0);
  const byWorkload = results.reduce<MixedLoadSummary["byWorkload"]>((acc, result) => {
    const current = acc[result.workload] ?? { count: 0, ok: 0, errors: 0 };
    return {
      ...acc,
      [result.workload]: {
        count: current.count + 1,
        ok: current.ok + (result.ok ? 1 : 0),
        errors: current.errors + (result.ok ? 0 : 1),
      },
    };
  }, {});
  return {
    requests: results.length,
    successful: successful.length,
    failed: results.length - successful.length,
    elapsedMs,
    requestsPerSecond: elapsedMs > 0 ? results.length / (elapsedMs / 1000) : 0,
    latencyMs: {
      min: latencies.length ? Math.min(...latencies) : 0,
      mean: mean(latencies),
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    tokensPerSecond: {
      mean: mean(tps),
      p50: percentile(tps, 50),
    },
    byWorkload,
    errors: results
      .filter((result) => !result.ok)
      .slice(0, 5)
      .map((result) => ({ statusCode: result.statusCode, workload: result.workload, error: result.error })),
  };
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
  const [loadRequests, setLoadRequests] = useState(64);
  const [loadConcurrency, setLoadConcurrency] = useState(16);
  const [loadMaxTokens, setLoadMaxTokens] = useState(256);
  const [loadPromptText, setLoadPromptText] = useState(DEFAULT_MIXED_PROMPT_TEXT);
  const [loadRunning, setLoadRunning] = useState(false);
  const [loadCompleted, setLoadCompleted] = useState(0);
  const [loadSummary, setLoadSummary] = useState<MixedLoadSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const availableModels = useMemo(() => {
    const models: { label: string; value: string; runtime: "ollama" | "sglang" | "vllm" }[] = [];
    if (ollama?.isAvailable && ollama.models.length > 0) {
      ollama.models.forEach((m) => {
        const name = m.name || m.model || "unknown";
        models.push({ label: name, value: `ollama:${name}`, runtime: "ollama" });
      });
    }
    if (sglang?.isAvailable && sglang.models.length > 0) {
      sglang.models.forEach((m) => {
        const name = m.id || m.name || "unknown";
        models.push({ label: name, value: `sglang:${name}`, runtime: "sglang" });
      });
    }
    if (vllm?.isAvailable && vllm.models.length > 0) {
      vllm.models.forEach((m) => {
        const name = m.id || m.name || "unknown";
        models.push({ label: name, value: `vllm:${name}`, runtime: "vllm" });
      });
    }
    return models;
  }, [ollama, sglang, vllm]);

  // Auto-select first model (only if no cached selection or stale format)
  useEffect(() => {
    const isValid = selectedModel && availableModels.some((m) => m.value === selectedModel);
    if (!isValid && availableModels.length > 0) {
      setSelectedModel(availableModels[0].value);
      setSelectedRuntime(availableModels[0].runtime);
    }
  }, [availableModels, selectedModel]);

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
      let data: Partial<BenchmarkResult> & { error?: string };
      try {
        data = await resp.json() as Partial<BenchmarkResult> & { error?: string };
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

  const runMixedLoad = async () => {
    setLoadRunning(true);
    setLoadCompleted(0);
    setLoadSummary(null);
    setLoadError(null);
    const base = getBaseUrl();
    const modelName = selectedModel.replace(/^(ollama|sglang|vllm):/, "");
    const requestCount = clampNumber(loadRequests, 4, 500);
    const concurrency = clampNumber(loadConcurrency, 1, 64);
    const maxTokens = clampNumber(loadMaxTokens, 16, 512);
    const startedAt = performance.now();
    try {
      const prompts = parseMixedPrompts(loadPromptText);
      const queue = Array.from({ length: requestCount }, () => pickWeightedPrompt(prompts));
      const results: MixedLoadResult[] = [];
      let cursor = 0;
      const runOne = async (prompt: MixedPrompt): Promise<MixedLoadResult> => {
        const started = performance.now();
        try {
          const response = await fetch(proxyUrl(`${base}/api/benchmarks/run`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelName,
              runtime: selectedRuntime,
              prompt: prompt.prompt,
              max_tokens: Math.min(maxTokens, prompt.max_tokens),
            }),
          });
          const data = await response.json() as Partial<BenchmarkResult> & { error?: string };
          return {
            ok: response.ok && data.status === "completed",
            statusCode: response.status,
            latencyMs: performance.now() - started,
            workload: prompt.name,
            tokensPerSecond: data.tokens_per_second ?? 0,
            generatedTokens: data.generated_tokens ?? 0,
            timeToFirstTokenMs: data.time_to_first_token_ms ?? null,
            error: data.error,
          };
        } catch (error) {
          return {
            ok: false,
            statusCode: null,
            latencyMs: performance.now() - started,
            workload: prompt.name,
            tokensPerSecond: 0,
            generatedTokens: 0,
            timeToFirstTokenMs: null,
            error: error instanceof Error ? error.message : "Network error",
          };
        }
      };
      const worker = async () => {
        while (cursor < queue.length) {
          const next = queue[cursor];
          cursor += 1;
          const result = await runOne(next);
          results.push(result);
          setLoadCompleted((value) => value + 1);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));
      setLoadSummary(summarizeMixedLoad(results, performance.now() - startedAt));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Invalid mixed-load configuration");
    } finally {
      setLoadRunning(false);
    }
  };

  // Load history
  const loadHistory = useCallback(async () => {
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
  }, [getBaseUrl]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (availableModels.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Timer className="h-8 w-8 mb-3 opacity-30" />
          <p className="text-sm font-medium">No AI Models Available</p>
          <p className="text-xs mt-1">
            Benchmarks require Ollama, SGLang, or vLLM with at least one loaded model.
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-500" />
            Mixed Concurrent Load Test
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Requests</label>
              <Input
                type="number"
                min={4}
                max={500}
                value={loadRequests}
                onChange={(event) => setLoadRequests(clampNumber(Number(event.target.value), 4, 500))}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Concurrency</label>
              <Input
                type="number"
                min={1}
                max={64}
                value={loadConcurrency}
                onChange={(event) => setLoadConcurrency(clampNumber(Number(event.target.value), 1, 64))}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Global Max Tokens</label>
              <Input
                type="number"
                min={16}
                max={512}
                value={loadMaxTokens}
                onChange={(event) => setLoadMaxTokens(clampNumber(Number(event.target.value), 16, 512))}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-muted-foreground font-medium">Weighted Prompt Mix JSONL</label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setLoadPromptText(DEFAULT_MIXED_PROMPT_TEXT)}
                disabled={loadRunning}
              >
                Reset defaults
              </Button>
            </div>
            <Textarea
              value={loadPromptText}
              onChange={(event) => setLoadPromptText(event.target.value)}
              className="min-h-[150px] text-xs font-mono"
              disabled={loadRunning}
            />
            <p className="text-[11px] text-muted-foreground">
              One JSON object per line with `name`, `prompt`, `weight`, and `max_tokens`. Defaults model a small real traffic burst: 64 requests, 16-way concurrency, 256 output tokens. Bounds: 4-500 requests, 1-64 concurrency, 16-512 tokens.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={runMixedLoad}
              disabled={loadRunning || running || !selectedModel}
              className="h-9 gap-1.5"
              size="sm"
            >
              {loadRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {loadRunning ? `Running ${loadCompleted}/${loadRequests}` : "Run Mixed Load"}
            </Button>
            <Badge variant="outline" className="text-[10px]">
              {selectedRuntime} · {selectedModel.replace(/^(ollama|sglang|vllm):/, "")}
            </Badge>
          </div>

          {loadError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-500 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {loadError}
            </div>
          )}

          {loadSummary && (
            <div className={`rounded-lg border p-4 space-y-4 ${loadSummary.failed > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={loadSummary.failed > 0 ? "secondary" : "outline"} className="text-[10px]">
                  {loadSummary.successful}/{loadSummary.requests} successful
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {loadSummary.requestsPerSecond.toFixed(2)} req/s
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  elapsed {formatDuration(loadSummary.elapsedMs)}
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard icon={Timer} label="Mean latency" value={formatDuration(loadSummary.latencyMs.mean)} color="text-blue-500" />
                <MetricCard icon={Clock} label="P95 latency" value={formatDuration(loadSummary.latencyMs.p95)} color="text-amber-500" />
                <MetricCard icon={TrendingUp} label="Mean tok/s" value={loadSummary.tokensPerSecond.mean.toFixed(1)} color="text-emerald-500" />
                <MetricCard icon={Hash} label="P50 tok/s" value={loadSummary.tokensPerSecond.p50.toFixed(1)} color="text-purple-500" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-md bg-muted/50 p-3 space-y-1">
                  <div className="font-medium text-muted-foreground">Workload mix</div>
                  {Object.entries(loadSummary.byWorkload).map(([name, stats]) => (
                    <div key={name} className="flex items-center justify-between gap-2 font-mono">
                      <span>{name}</span>
                      <span>{stats.ok}/{stats.count} ok</span>
                    </div>
                  ))}
                </div>
                <div className="rounded-md bg-muted/50 p-3 space-y-1">
                  <div className="font-medium text-muted-foreground">Latency percentiles</div>
                  <div className="flex items-center justify-between gap-2 font-mono"><span>p50</span><span>{formatDuration(loadSummary.latencyMs.p50)}</span></div>
                  <div className="flex items-center justify-between gap-2 font-mono"><span>p95</span><span>{formatDuration(loadSummary.latencyMs.p95)}</span></div>
                  <div className="flex items-center justify-between gap-2 font-mono"><span>p99</span><span>{formatDuration(loadSummary.latencyMs.p99)}</span></div>
                </div>
              </div>
              {loadSummary.errors.length > 0 && (
                <div className="rounded-md bg-red-500/5 border border-red-500/20 p-3 text-xs space-y-1">
                  <div className="font-medium text-red-500">Sample errors</div>
                  {loadSummary.errors.map((error, index) => (
                    <div key={`${error.workload}-${index}`} className="text-muted-foreground">
                      {error.statusCode ?? "network"} · {error.workload} · {error.error || "unknown error"}
                    </div>
                  ))}
                </div>
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
  icon: LucideIcon;
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
