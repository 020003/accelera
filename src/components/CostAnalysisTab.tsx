import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  DollarSign,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Coins,
  Search,
  AlertCircle,
} from "lucide-react";
import { useModelCatalog, type CatalogModel } from "@/hooks/useModelCatalog";
import { useFleetTokenStats } from "@/hooks/useFleetTokenStats";
import { useQueryClient } from "@tanstack/react-query";

interface Host {
  url: string;
  name: string;
}

interface Props {
  hosts: Host[];
}

type TimeWindow = "24h" | "7d" | "30d";

const WINDOW_HOURS: Record<TimeWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

function fmtUsd(v: number): string {
  if (!isFinite(v) || v <= 0) return "$0.00";
  if (v >= 1000) return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(3)}`;
  if (v >= 0.0001) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${n}`;
}

function fmtAgo(epochSec: number): string {
  if (!epochSec) return "never";
  const ageSec = Math.max(0, Date.now() / 1000 - epochSec);
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}min ago`;
  return `${Math.round(ageSec / 3600)}h ago`;
}

interface Row extends CatalogModel {
  cost_prompt: number;
  cost_completion: number;
  cost_total: number;
}

export function CostAnalysisTab({ hosts }: Props) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [useCumulative, setUseCumulative] = useState(false);
  const [providerFilter, setProviderFilter] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const hostUrls = hosts.map((h) => h.url);
  const catalogQ = useModelCatalog();
  const tokens = useFleetTokenStats(hostUrls, WINDOW_HOURS[timeWindow]);
  const qc = useQueryClient();

  const promptTokens = useCumulative
    ? tokens.data.summary.cumulative_prompt
    : tokens.data.summary.total_prompt;
  const completionTokens = useCumulative
    ? tokens.data.summary.cumulative_generated
    : tokens.data.summary.total_generated;
  const totalTokens = promptTokens + completionTokens;

  const allProviders = useMemo(() => {
    const s = new Set<string>();
    (catalogQ.data?.models ?? []).forEach((m) => s.add(m.provider));
    return [...s].sort();
  }, [catalogQ.data]);

  const rows: Row[] = useMemo(() => {
    const models = catalogQ.data?.models ?? [];
    const q = search.trim().toLowerCase();
    return models
      .filter((m) => providerFilter.size === 0 || providerFilter.has(m.provider))
      .filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q),
      )
      .map<Row>((m) => {
        const cost_prompt = (promptTokens * m.prompt_per_mtok) / 1_000_000;
        const cost_completion = (completionTokens * m.completion_per_mtok) / 1_000_000;
        return {
          ...m,
          cost_prompt,
          cost_completion,
          cost_total: cost_prompt + cost_completion,
        };
      })
      .sort((a, b) => a.cost_total - b.cost_total);
  }, [catalogQ.data, providerFilter, search, promptTokens, completionTokens]);

  const cheapest = rows[0];
  const mostExpensive = rows[rows.length - 1];
  const median = rows.length > 0 ? rows[Math.floor(rows.length / 2)] : undefined;
  const maxCost = mostExpensive?.cost_total ?? 0;

  const toggleProvider = (p: string) => {
    setProviderFilter((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const refreshCatalog = async () => {
    // Force the central backend to re-pull from OpenRouter, then
    // invalidate the React Query cache so the UI shows fresh prices.
    try {
      await fetch("/api/costs/models?refresh=1", { credentials: "include" });
    } catch {
      /* ignore — invalidate below will trigger a normal refetch */
    }
    qc.invalidateQueries({ queryKey: ["model-catalog"] });
  };

  return (
    <div className="space-y-4">
      {/* Header / filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-emerald" />
            Cloud-Cost Equivalent
            <Badge variant="secondary" className="text-[10px] ml-1">
              {catalogQ.data?.count ?? 0} models · {catalogQ.data?.source ?? "loading"}
            </Badge>
            <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
              catalog: {fmtAgo(catalogQ.data?.fetched_at ?? 0)}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={refreshCatalog}
                disabled={catalogQ.isFetching}
              >
                <RefreshCw className={`h-3 w-3 ${catalogQ.isFetching ? "animate-spin" : ""}`} />
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            What your fleet&apos;s locally-generated tokens would have cost on each commercial
            LLM API. Helps quantify the dollar value of self-hosted GPU inference vs. paying
            per-token to OpenAI, Anthropic, Google, Moonshot, etc.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Time window
              </label>
              <Select
                value={useCumulative ? "cumulative" : timeWindow}
                onValueChange={(v) => {
                  if (v === "cumulative") setUseCumulative(true);
                  else {
                    setUseCumulative(false);
                    setTimeWindow(v as TimeWindow);
                  }
                }}
              >
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="cumulative">All time (cumulative)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1 flex-1 min-w-[200px]">
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Search model
              </label>
              <div className="relative">
                <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="claude, gpt-4o, kimi, llama…"
                  className="h-9 pl-8"
                />
              </div>
            </div>
          </div>

          {/* Provider chips */}
          {allProviders.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="text-[11px] text-muted-foreground self-center mr-1">
                Providers:
              </span>
              {allProviders.map((p) => {
                const active = providerFilter.has(p);
                return (
                  <button
                    key={p}
                    onClick={() => toggleProvider(p)}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition cursor-pointer ${
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
              {providerFilter.size > 0 && (
                <button
                  onClick={() => setProviderFilter(new Set())}
                  className="text-[11px] px-2 py-0.5 rounded-full text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  clear
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Tokens analysed
            </div>
            <div className="text-2xl font-bold tabular-nums">{fmtTokens(totalTokens)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums mt-1">
              {fmtTokens(promptTokens)} prompt · {fmtTokens(completionTokens)} completion
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingDown className="h-3 w-3 text-emerald" /> Cheapest equivalent
            </div>
            <div className="text-2xl font-bold tabular-nums text-emerald">
              {cheapest ? fmtUsd(cheapest.cost_total) : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-1">
              {cheapest ? cheapest.name : "no data"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              Median model
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {median ? fmtUsd(median.cost_total) : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-1">
              {median ? median.name : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-rose-400" /> Most expensive
            </div>
            <div className="text-2xl font-bold tabular-nums text-rose-400">
              {mostExpensive ? fmtUsd(mostExpensive.cost_total) : "—"}
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-1">
              {mostExpensive ? mostExpensive.name : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty states */}
      {hosts.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4" /> Add a host to see fleet cost analysis.
          </CardContent>
        </Card>
      )}
      {hosts.length > 0 && totalTokens === 0 && !tokens.isLoading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
            <Coins className="h-4 w-4" /> No tokens recorded in the selected window yet.
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {rows.length > 0 && totalTokens > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Per-model cost · sorted ascending ({rows.length} models)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Model</th>
                    <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">Provider</th>
                    <th className="text-right font-medium px-3 py-2 hidden md:table-cell">
                      $/Mtok in
                    </th>
                    <th className="text-right font-medium px-3 py-2 hidden md:table-cell">
                      $/Mtok out
                    </th>
                    <th className="text-right font-medium px-3 py-2">Prompt cost</th>
                    <th className="text-right font-medium px-3 py-2">Completion cost</th>
                    <th className="text-right font-medium px-3 py-2">Total</th>
                    <th className="text-left font-medium px-3 py-2 hidden lg:table-cell w-[30%]">
                      vs cheapest
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ratio = maxCost > 0 ? r.cost_total / maxCost : 0;
                    const vsCheapest =
                      cheapest && cheapest.cost_total > 0
                        ? r.cost_total / cheapest.cost_total
                        : 0;
                    return (
                      <tr
                        key={r.id}
                        className="border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium truncate max-w-[260px]">{r.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[260px]">
                            {r.id}
                          </div>
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-5">
                            {r.provider}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                          ${r.prompt_per_mtok.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                          ${r.completion_per_mtok.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtUsd(r.cost_prompt)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {fmtUsd(r.cost_completion)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {fmtUsd(r.cost_total)}
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full bg-emerald transition-all"
                                style={{ width: `${Math.max(2, ratio * 100)}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right">
                              {vsCheapest >= 1 ? `${vsCheapest.toFixed(1)}×` : "—"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Pricing is fetched from OpenRouter&apos;s public catalog and cached for 6 hours.
        Estimates assume your prompt/completion split would have been billed identically by
        the upstream provider (no batching, prompt-caching, or volume discounts applied).
      </p>
    </div>
  );
}
