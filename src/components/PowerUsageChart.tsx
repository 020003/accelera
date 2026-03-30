import { memo, useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Zap, TrendingUp, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GpuInfo } from "@/types/gpu";

interface PowerDataPoint {
  timestamp: string;
  time: string;
  [key: string]: number | string; // Dynamic keys for each host
}

interface PowerUsageChartProps {
  hosts: Array<{
    url: string;
    name: string;
    isConnected: boolean;
  }>;
  hostData: Map<string, { gpus: GpuInfo[]; timestamp?: string }>;
  refreshInterval: number;
  energyRate?: number;
  currencySymbol?: string;
}

const CHART_COLORS = [
  "rgb(59, 130, 246)",   // Blue
  "rgb(34, 197, 94)",    // Green
  "rgb(251, 146, 60)",   // Orange
  "rgb(147, 51, 234)",   // Purple
  "rgb(239, 68, 68)",    // Red
  "rgb(250, 204, 21)",   // Yellow
  "rgb(14, 165, 233)",   // Sky
  "rgb(236, 72, 153)",   // Pink
];

const MAX_DATA_POINTS = 20; // Keep last 20 data points for better performance

export const PowerUsageChart = memo(function PowerUsageChart({ 
  hosts, 
  hostData, 
  refreshInterval,
  energyRate = 0,
  currencySymbol = "$"
}: PowerUsageChartProps) {
  const [chartData, setChartData] = useState<PowerDataPoint[]>([]);
  const [totalPower, setTotalPower] = useState(0);
  const [trend, setTrend] = useState<"up" | "down" | "stable">("stable");
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    // Throttle updates to prevent performance issues
    const now = Date.now();
    if (now - lastUpdateRef.current < 2000) return;
    lastUpdateRef.current = now;
    
    // Skip update if refresh interval is too fast
    if (refreshInterval < 3000) return;
    
    // Build new data point from current host data
    const newPoint: PowerDataPoint = {
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    let currentTotal = 0;
    
    hosts.forEach((host) => {
      if (host.isConnected && hostData.has(host.url)) {
        const data = hostData.get(host.url);
        if (data?.gpus) {
          const hostPower = data.gpus.reduce((sum: number, gpu: GpuInfo) => 
            sum + (gpu.power?.draw || 0), 0
          );
          newPoint[host.name || host.url] = hostPower;
          currentTotal += hostPower;
        }
      }
    });

    setTotalPower(currentTotal);

    setChartData((prev) => {
      const updated = [...prev, newPoint].slice(-MAX_DATA_POINTS);
      
      // Calculate trend
      if (updated.length > 1) {
        const prevTotal = Object.keys(updated[updated.length - 2])
          .filter(k => k !== 'time' && k !== 'timestamp')
          .reduce((sum, key) => sum + (Number(updated[updated.length - 2][key]) || 0), 0);
        
        if (currentTotal > prevTotal * 1.05) setTrend("up");
        else if (currentTotal < prevTotal * 0.95) setTrend("down");
        else setTrend("stable");
      }
      
      return updated;
    });
  }, [hosts, hostData, refreshInterval]);

  const formatYAxis = (value: number) => `${value}W`;
  
  const formatTooltip = (value: number, name: string) => {
    const cost = energyRate > 0 ? (value / 1000) * energyRate : 0;
    return [
      `${value}W`,
      cost > 0 ? `(${currencySymbol}${cost.toFixed(3)}/hr)` : name
    ];
  };

  const hourlyCost = energyRate > 0 ? (totalPower / 1000) * energyRate : 0;

  return (
    <Card className="col-span-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="h-5 w-5 text-gpu-orange" />
            <CardTitle>Power Usage Timeline</CardTitle>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {trend === "up" && <TrendingUp className="h-4 w-4 text-gpu-red" />}
              {trend === "down" && <TrendingDown className="h-4 w-4 text-gpu-green" />}
              <span className="text-2xl font-bold font-mono">{totalPower}W</span>
            </div>
            {hourlyCost > 0 && (
              <Badge variant="outline" className="text-emerald font-medium">
                {currencySymbol}{hourlyCost.toFixed(2)}/hr
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <defs>
              {CHART_COLORS.map((color, index) => (
                <linearGradient key={index} id={`gradient${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0}/>
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="hsl(var(--border))"
              vertical={false}
            />
            <XAxis 
              dataKey="time" 
              stroke="hsl(var(--border))"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <YAxis 
              tickFormatter={formatYAxis}
              stroke="hsl(var(--border))"
              tick={{ fontSize: 12 }}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={{ 
                background: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={formatTooltip}
            />
            <Legend 
              wrapperStyle={{ paddingTop: '20px' }}
              iconType="line"
            />
            {hosts.map((host, index) => {
              if (!host.isConnected) return null;
              const color = CHART_COLORS[index % CHART_COLORS.length];
              return (
                <Line
                  key={host.url}
                  type="monotone"
                  dataKey={host.name || host.url}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#gradient${index % CHART_COLORS.length})`}
                  dot={false}
                  activeDot={{ r: 6, fill: color }}
                  connectNulls
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
        
        {chartData.length === 0 && (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            <div className="text-center">
              <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Collecting power usage data...</p>
              <p className="text-sm mt-1">Data will appear after a few refresh cycles</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

export default PowerUsageChart;