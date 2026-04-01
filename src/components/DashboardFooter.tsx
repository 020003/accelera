import type { HostData } from "@/types/dashboard";

interface DashboardFooterProps {
  totalGpus: number;
  connectedHosts: HostData[];
  totalAiModels: number;
}

export function DashboardFooter({ totalGpus, connectedHosts, totalAiModels }: DashboardFooterProps) {
  return (
    <footer className="border-t bg-card/50">
      <div className="container mx-auto px-4 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-1 text-xs sm:text-sm text-muted-foreground">
          <div>Accelera v2.1.0 — GPU Monitoring Platform</div>
          <div className="hidden sm:flex items-center gap-4">
            {totalGpus > 0 && (
              <span>
                {totalGpus} GPU{totalGpus !== 1 ? 's' : ''} across {connectedHosts.length} host{connectedHosts.length !== 1 ? 's' : ''}
              </span>
            )}
            {totalAiModels > 0 && (
              <span>
                {totalAiModels} AI model{totalAiModels !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
