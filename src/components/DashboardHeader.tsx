import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sun, Moon, Timer, AlertTriangle, Search } from "lucide-react";
import type { HostData } from "@/types/dashboard";

interface FleetFreshnessSummary {
  totalHosts: number;
  onlineHosts: number;
  offlineHosts: number;
  liveHosts: number;
  cachedHosts: number;
  staleHosts: number;
  oldestCacheAgeSeconds: number;
  oldestSampleAgeSeconds: number;
}

interface DashboardHeaderProps {
  theme: string;
  toggleTheme: () => void;
  connectedHosts: HostData[];
  hostsData: HostData[];
  totalGpus: number;
  totalAiModels: number;
  hostsWithOllama: number;
  hostsWithSglang: number;
  hostsWithVllm: number;
  performanceMode: string;
  refreshInterval: number;
  fleetFetchDurationMs?: number;
  fleetFreshness?: FleetFreshnessSummary;
  onOpenPalette?: () => void;
}

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

export function DashboardHeader({
  theme,
  toggleTheme,
  connectedHosts,
  hostsData,
  totalGpus,
  totalAiModels,
  hostsWithOllama,
  hostsWithSglang,
  hostsWithVllm,
  performanceMode,
  refreshInterval,
  fleetFetchDurationMs,
  fleetFreshness,
  onOpenPalette,
}: DashboardHeaderProps) {
  const staleHosts = fleetFreshness?.staleHosts || 0;
  const cachedHosts = fleetFreshness?.cachedHosts || 0;
  const runtimeHosts = hostsWithOllama + hostsWithSglang + hostsWithVllm;
  const online = connectedHosts.length > 0 || runtimeHosts > 0;

  return (
    <header className="navbar border-white/5">
      <div className="mx-auto max-w-[1800px] px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/logo.png"
              alt="Accelera"
              className="h-10 w-auto drop-shadow-[0_0_18px_hsl(var(--primary)/0.3)]"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-foreground sm:text-xl">Accelera</h1>
                <Badge variant="outline" className="hidden border-primary/20 bg-primary/10 text-[9px] uppercase tracking-[0.16em] text-primary sm:inline-flex">Control plane</Badge>
              </div>
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                GPU infrastructure and inference operations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-1.5 rounded-xl border border-border/60 bg-background/45 p-1.5 xl:flex">
              <HeaderMetric label="Hosts" value={`${connectedHosts.length}/${hostsData.length}`} />
              <HeaderMetric label="GPUs" value={totalGpus.toString()} />
              {totalAiModels > 0 && <HeaderMetric label="Models" value={totalAiModels.toString()} />}
              <Badge variant="outline" className="gap-1 text-[11px] capitalize">
                <Timer className="h-3 w-3" />
                {performanceMode.replace("-", " ")} · {refreshInterval > 0 ? `${refreshInterval / 1000}s` : "manual"}
              </Badge>
              {typeof fleetFetchDurationMs === "number" && (
                <Badge variant="secondary" className="text-[11px]">
                  Snapshot {fleetFetchDurationMs}ms
                </Badge>
              )}
              {(staleHosts > 0 || cachedHosts > 0) && (
                <Badge variant="outline" className="gap-1 text-[11px] text-amber-500 border-amber-500/30 bg-amber-500/10">
                  <AlertTriangle className="h-3 w-3" />
                  {staleHosts} stale · {cachedHosts} cached
                </Badge>
              )}
            </div>
            {onOpenPalette && (
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenPalette}
                className="h-8 gap-2 border-border/60 bg-background/40 px-2 text-xs text-muted-foreground hover:text-foreground sm:w-44 sm:justify-between sm:px-2.5"
                title="Search hosts, sections and actions"
                aria-label="Open command palette"
              >
                <span className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Search…</span>
                </span>
                <kbd className="pointer-events-none hidden select-none rounded border border-border/70 bg-muted/60 px-1.5 font-mono text-[10px] font-medium sm:inline-block">
                  {IS_MAC ? "⌘" : "Ctrl"} K
                </kbd>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className={`flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium ${
              online
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-500"
                : "border-red-500/20 bg-red-500/10 text-red-500"
            }`}>
              <div className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500 animate-pulse-slow" : "bg-red-500"}`} />
              {online ? "Operational" : "Offline"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-16 rounded-lg px-2.5 py-1 text-center">
      <div className="font-mono text-sm font-bold leading-none">{value}</div>
      <div className="mt-1 text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
