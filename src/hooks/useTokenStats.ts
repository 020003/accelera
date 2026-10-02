import { useQuery } from "@tanstack/react-query";
import { proxyUrl } from "@/lib/proxy";

export interface TokenModelStats {
  generated_tokens: number;
  prompt_tokens: number;
  requests: number;
  total_duration_sec: number;
  avg_tokens_per_sec: number;
  avg_latency_sec?: number;
  avg_prompt_tokens?: number;
  avg_generated_tokens?: number;
  cumulative_generated: number;
  cumulative_prompt: number;
  cumulative_requests: number;
}

export interface TokenHistoryPoint {
  time: string;
  generated: number;
  prompt: number;
  total: number;
}

export interface TokenStats {
  summary: {
    total_generated: number;
    total_prompt: number;
    total_tokens: number;
    total_requests: number;
    total_duration_sec: number;
    current_tps: number;
    peak_generation_tps: number;
    requests_per_minute: number;
    avg_request_latency_sec: number;
    avg_tokens_per_request: number;
    prompt_to_generated_ratio: number;
    cumulative_generated: number;
    cumulative_prompt: number;
    cumulative_tokens: number;
    cumulative_requests: number;
    bucket_sec?: number;
  };
  models: Record<string, TokenModelStats>;
  history: TokenHistoryPoint[];
}

export interface LLMStatus {
  runtime: string;
  available: boolean;
  collected_at: number;
  scheduler: { running: number; waiting: number; swapped: number };
  cache: { gpu_usage_pct: number; cpu_usage_pct: number };
  prefix_cache: { queries: number; hits: number; hit_rate_pct: number };
  preemptions: number;
  counters: { prompt_tokens: number; generated_tokens: number; successful_requests: number };
  throughput: {
    prompt_tokens_per_second: number;
    generation_tokens_per_second: number;
    total_tokens_per_second: number;
  };
  endpoints?: string[];
  instances?: Array<{
    endpoint: string;
    scheduler: { running: number; waiting: number; swapped: number };
    cache: { gpu_usage_pct: number; cpu_usage_pct: number };
    prefix_cache: { queries: number; hits: number; hit_rate_pct: number };
    preemptions: number;
    counters: { prompt_tokens: number; generated_tokens: number; successful_requests: number };
  }>;
}

export function useTokenStats(hostUrl?: string, hours = 24) {
  const baseUrl = hostUrl?.replace(/\/nvidia-smi\.json$/, "") ?? "";

  return useQuery<TokenStats>({
    queryKey: ["token-stats", baseUrl, hours],
    queryFn: async () => {
      const res = await fetch(proxyUrl(`${baseUrl}/api/tokens/stats?hours=${hours}`));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    enabled: !!baseUrl,
    refetchInterval: 30_000,
  });
}

export function useLLMStatus(hostUrl?: string, enabled = true) {
  const baseUrl = hostUrl?.replace(/\/nvidia-smi\.json$/, "") ?? "";
  return useQuery<LLMStatus>({
    queryKey: ["llm-status", baseUrl],
    queryFn: async () => {
      const res = await fetch(proxyUrl(`${baseUrl}/api/llm/status`));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json();
    },
    enabled: !!baseUrl && enabled,
    refetchInterval: 5_000,
    retry: false,
  });
}
