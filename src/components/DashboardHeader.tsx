import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sun, Moon, Timer, AlertTriangle } from "lucide-react";
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
  performanceMode: string;
  refreshInterval: number;
  fleetFetchDurationMs?: number;
  fleetFreshness?: FleetFreshnessSummary;
}

export function DashboardHeader({
  theme,
  toggleTheme,
  connectedHosts,
  hostsData,
  totalGpus,
  totalAiModels,
  hostsWithOllama,
  hostsWithSglang,
  performanceMode,
  refreshInterval,
  fleetFetchDurationMs,
  fleetFreshness,
}: DashboardHeaderProps) {
  const staleHosts = fleetFreshness?.staleHosts || 0;
  const cachedHosts = fleetFreshness?.cachedHosts || 0;

  return (
    <header className="navbar">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img
              src="/logo.png"
              alt="Accelera"
              className="h-9 sm:h-12 w-auto"
            />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Accelera</h1>
              <p className="text-sm text-muted-foreground hidden sm:block">
                High-Performance GPU Acceleration Platform
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden xl:flex items-center gap-3 text-sm text-muted-foreground">
              <span><span className="font-medium">Hosts:</span> {connectedHosts.length}/{hostsData.length}</span>
              <span><span className="font-medium">GPUs:</span> {totalGpus}</span>
              {totalAiModels > 0 && (
                <span><span className="font-medium">AI Models:</span> {totalAiModels}</span>
              )}
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 cursor-pointer"
              onClick={toggleTheme}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm ${
              (connectedHosts.length > 0 || hostsWithOllama > 0 || hostsWithSglang > 0)
                ? "bg-accelera-green/10 text-accelera-green"
                : "bg-red-500/10 text-red-500"
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                (connectedHosts.length > 0 || hostsWithOllama > 0 || hostsWithSglang > 0) ? "bg-accelera-green animate-pulse-slow" : "bg-red-500"
              }`} />
              {(connectedHosts.length > 0 || hostsWithOllama > 0 || hostsWithSglang > 0) ? "Online" : "Offline"}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
