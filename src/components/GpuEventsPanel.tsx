import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, AlertTriangle, Info, Cpu, Thermometer, Zap, MemoryStick, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGpuEvents } from "@/hooks/useGpuEvents";
import type { GpuEvent } from "@/types/events";

function eventIcon(type: string) {
  switch (type) {
    case "thermal_throttle":
    case "power_throttle":
      return <Thermometer className="h-4 w-4 text-red-500" />;
    case "ecc_corrected":
    case "ecc_uncorrected":
    case "retired_pages":
      return <MemoryStick className="h-4 w-4 text-yellow-500" />;
    case "xid_error":
      return <Zap className="h-4 w-4 text-red-500" />;
    default:
      return <Cpu className="h-4 w-4 text-muted-foreground" />;
  }
}

function severityVariant(severity: string): "destructive" | "secondary" | "outline" {
  switch (severity) {
    case "critical":
      return "destructive";
    case "warning":
      return "secondary";
    default:
      return "outline";
  }
}

function eventTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    thermal_throttle: "Thermal Throttle",
    power_throttle: "Power Throttle",
    ecc_corrected: "ECC Corrected",
    ecc_uncorrected: "ECC Uncorrected",
    retired_pages: "Retired Pages",
    xid_error: "XID Error",
  };
  return labels[type] || type;
}

interface GpuEventsPanelProps {
  hostUrl?: string;
}

export function GpuEventsPanel({ hostUrl }: GpuEventsPanelProps) {
  const { data, isLoading, isError, refetch, isFetching } = useGpuEvents(hostUrl, true);

  const events = data?.events ?? [];
  const criticalCount = events.filter((e) => e.severity === "critical").length;
  const warningCount = events.filter((e) => e.severity === "warning").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">GPU Health Events</h3>
          {events.length > 0 && (
            <div className="flex items-center gap-2">
              {criticalCount > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" /> {criticalCount} critical
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="secondary" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> {warningCount} warning
                </Badge>
              )}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading GPU events...</p>}

      {isError && (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            Could not fetch GPU events. The host may not support this feature or is unreachable.
          </CardContent>
        </Card>
      )}

      {!isLoading && !isError && events.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="flex flex-col items-center gap-2">
              <Info className="h-8 w-8 text-green-500" />
              <p className="font-medium text-green-600">All Clear</p>
              <p className="text-sm text-muted-foreground">
                No GPU errors, throttling, or ECC issues detected.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {events.map((event, idx) => (
        <Card key={`${event.type}-${event.gpu_id}-${idx}`}>
          <CardContent className="flex items-start gap-3 py-3 px-4">
            <div className="mt-0.5 shrink-0">{eventIcon(event.type)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{eventTypeLabel(event.type)}</span>
                <Badge variant={severityVariant(event.severity)} className="text-[10px] h-4">
                  {event.severity}
                </Badge>
                {event.gpu_name && (
                  <span className="text-xs text-muted-foreground">
                    GPU {event.gpu_id} ({event.gpu_name})
                  </span>
                )}
                {event.count !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    Count: {event.count}
                  </span>
                )}
                {event.xid !== undefined && (
                  <span className="text-xs text-muted-foreground">XID {event.xid}</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 break-all">{event.message}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
