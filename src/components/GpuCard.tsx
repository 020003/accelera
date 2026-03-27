import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { GpuInfo } from "@/types/gpu";
import { 
  Activity, 
  HardDrive, 
  Thermometer, 
  Zap, 
  Fan,
  Cpu,
  Clock
} from "lucide-react";

interface GpuCardProps {
  gpu: GpuInfo;
  energyRate?: number;
  currencySymbol?: string;
}

function getStatusColor(value: number, type: 'temp' | 'util' | 'memory'): string {
  switch (type) {
    case 'temp':
      if (value >= 85) return 'critical';
      if (value >= 75) return 'warning';
      return 'online';
    case 'util':
      if (value >= 95) return 'critical';
      if (value >= 80) return 'warning';
      return 'online';
    case 'memory':
      if (value >= 90) return 'critical';
      if (value >= 75) return 'warning';
      return 'online';
    default:
      return 'online';
  }
}

function getProgressVariant(value: number, type: 'temp' | 'util' | 'memory'): 'normal' | 'warning' | 'critical' {
  const status = getStatusColor(value, type);
  if (status === 'critical') return 'critical';
  if (status === 'warning') return 'warning';
  return 'normal';
}

export const GpuCard = memo(function GpuCard({ gpu, energyRate = 0, currencySymbol = "$" }: GpuCardProps) {
  const memoryUsedPercent = Math.round((gpu.memory.used / gpu.memory.total) * 100);
  const powerUsedPercent = Math.round((gpu.power.draw / gpu.power.limit) * 100);
  const hourlyEnergyCost = energyRate > 0 ? (gpu.power.draw / 1000) * energyRate : 0;

  return (
    <Card className="gpu-card">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg font-semibold text-foreground">
              {gpu.name}
            </CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="h-4 w-4" />
              <span>GPU {gpu.id}</span>
              {gpu.driverVersion && (
                <>
                  <span>•</span>
                  <span>Driver {gpu.driverVersion}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full status-${getStatusColor(gpu.utilization, 'util')}`} />
            <Badge variant={gpu.temperature >= 85 ? 'destructive' : gpu.temperature >= 75 ? 'secondary' : 'default'}>
              <Thermometer className="h-3 w-3 mr-1" />
              {gpu.temperature}°C
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* GPU Utilization */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald" />
              <span className="text-sm font-medium">Utilization</span>
            </div>
            <span className="text-sm font-mono font-bold">{gpu.utilization}%</span>
          </div>
          <div className="progress-bar">
            <div 
              className={`progress-fill ${getProgressVariant(gpu.utilization, 'util')}`}
              style={{ width: `${gpu.utilization}%` }}
            />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-gpu-blue" />
              <span className="text-sm font-medium">Memory</span>
            </div>
            <span className="text-sm font-mono font-bold">
              {gpu.memory.used} / {gpu.memory.total} MB ({memoryUsedPercent}%)
            </span>
          </div>
          <div className="progress-bar">
            <div 
              className={`progress-fill ${getProgressVariant(memoryUsedPercent, 'memory')}`}
              style={{ width: `${memoryUsedPercent}%` }}
            />
          </div>
        </div>

        {/* Power and Temperature Grid */}
        <div className="grid grid-cols-2 gap-4">
          <div className="metric-card">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-4 w-4 text-gpu-orange" />
              <span className="text-sm font-medium">Power</span>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-bold font-mono">{gpu.power.draw}W</div>
              <div className="text-xs text-muted-foreground">
                {powerUsedPercent}% of {gpu.power.limit}W limit
              </div>
              {hourlyEnergyCost > 0 && (
                <div className="text-xs text-emerald font-medium">
                  {currencySymbol}{hourlyEnergyCost.toFixed(3)}/hr
                </div>
              )}
            </div>
          </div>

          <div className="metric-card">
            <div className="flex items-center gap-2 mb-2">
              <Fan className="h-4 w-4 text-gpu-purple" />
              <span className="text-sm font-medium">Fan Speed</span>
            </div>
            <div className="space-y-1">
              <div className="text-lg font-bold font-mono">{gpu.fan ?? 0}%</div>
              <div className="text-xs text-muted-foreground">
                {gpu.fan && gpu.fan > 0 ? 'Active cooling' : 'Passive cooling'}
              </div>
            </div>
          </div>
        </div>

        {/* Running Processes */}
        {gpu.processes && gpu.processes.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald" />
              <span className="text-sm font-medium">Running Processes ({gpu.processes.length})</span>
            </div>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {gpu.processes.map((process) => (
                <div key={process.pid} className="process-item">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{process.name}</div>
                    <div className="text-xs text-muted-foreground">PID: {process.pid}</div>
                  </div>
                  <div className="text-sm font-mono font-bold text-gpu-blue">
                    {process.memory} MB
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">No active GPU processes</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default GpuCard;