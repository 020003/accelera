import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";
import type { HostData } from "@/types/dashboard";

interface DashboardHeaderProps {
  theme: string;
  toggleTheme: () => void;
  connectedHosts: HostData[];
  hostsData: HostData[];
  totalGpus: number;
  totalAiModels: number;
  hostsWithOllama: number;
  hostsWithSglang: number;
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
}: DashboardHeaderProps) {
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
            <div className="hidden lg:flex items-center gap-4 text-sm text-muted-foreground">
              <span><span className="font-medium">Hosts:</span> {connectedHosts.length}/{hostsData.length}</span>
              <span><span className="font-medium">GPUs:</span> {totalGpus}</span>
              {totalAiModels > 0 && (
                <span><span className="font-medium">AI Models:</span> {totalAiModels}</span>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
