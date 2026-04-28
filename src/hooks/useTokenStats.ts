import { useQuery } from "@tanstack/react-query";
import { proxyUrl } from "@/lib/proxy";

export interface TokenModelStats {
  generated_tokens: number;
  prompt_tokens: number;
  requests: number;
  total_duration_sec: number;
  avg_tokens_per_sec: number;
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
    cumulative_generated: number;
    cumulative_prompt: number;
    cumulative_tokens: number;
    cumulative_requests: number;
    bucket_sec?: number;
  };
  models: Record<string, TokenModelStats>;
  history: TokenHistoryPoint[];
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
