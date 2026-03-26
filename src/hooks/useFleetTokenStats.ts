import { useQueries } from "@tanstack/react-query";
import type { TokenStats, TokenModelStats, TokenHistoryPoint } from "./useTokenStats";

export interface FleetTokenStats {
  summary: {
    total_generated: number;
    total_prompt: number;
    total_tokens: number;
    total_requests: number;
    total_duration_sec: number;
    current_tps: number;
  };
  models: Record<string, TokenModelStats>;
  history: TokenHistoryPoint[];
  perHost: Record<string, TokenStats>;
}

export function useFleetTokenStats(
  hostUrls: string[],
  hours = 24
) {
  const queries = useQueries({
    queries: hostUrls.map((url) => {
      const base = url.replace(/\/nvidia-smi\.json$/, "");
      return {
        queryKey: ["fleet-token-stats", base, hours],
        queryFn: async (): Promise<{ url: string; data: TokenStats }> => {
          const res = await fetch(`${base}/api/tokens/stats?hours=${hours}`);
          if (!res.ok) throw new Error(`${res.status}`);
          const data: TokenStats = await res.json();
          return { url, data };
        },
        enabled: !!base,
        refetchInterval: 30_000,
        retry: 1,
      };
    }),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const perHost: Record<string, TokenStats> = {};
  const mergedModels: Record<string, TokenModelStats> = {};
  let totalGen = 0,
    totalPt = 0,
    totalReq = 0,
    totalDur = 0,
    totalTps = 0;

  for (const q of queries) {
    if (!q.data) continue;
    const { url, data } = q.data;
    perHost[url] = data;
    totalGen += data.summary.total_generated;
    totalPt += data.summary.total_prompt;
    totalReq += data.summary.total_requests;
    totalDur += data.summary.total_duration_sec;
    totalTps += data.summary.current_tps;

    for (const [model, stats] of Object.entries(data.models)) {
      if (!mergedModels[model]) {
        mergedModels[model] = { ...stats };
      } else {
        mergedModels[model].generated_tokens += stats.generated_tokens;
        mergedModels[model].prompt_tokens += stats.prompt_tokens;
        mergedModels[model].requests += stats.requests;
        mergedModels[model].total_duration_sec += stats.total_duration_sec;
        // weighted avg would be better but simple avg is fine for overview
        mergedModels[model].avg_tokens_per_sec = Math.round(
          (mergedModels[model].avg_tokens_per_sec + stats.avg_tokens_per_sec) / 2
        );
      }
    }
  }

  // Merge history across hosts (union of time buckets)
  const histMap = new Map<string, TokenHistoryPoint>();
  for (const q of queries) {
    if (!q.data) continue;
    for (const pt of q.data.data.history) {
      const existing = histMap.get(pt.time);
      if (existing) {
        existing.generated += pt.generated;
        existing.prompt += pt.prompt;
        existing.total += pt.total;
      } else {
        histMap.set(pt.time, { ...pt });
      }
    }
  }
  const history = [...histMap.values()].sort(
    (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
  );

  const fleet: FleetTokenStats = {
    summary: {
      total_generated: totalGen,
      total_prompt: totalPt,
      total_tokens: totalGen + totalPt,
      total_requests: totalReq,
      total_duration_sec: Math.round(totalDur * 10) / 10,
      current_tps: Math.round(totalTps * 10) / 10,
    },
    models: mergedModels,
    history,
    perHost,
  };

  return { data: fleet, isLoading };
}
