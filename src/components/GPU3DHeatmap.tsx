import React, { useEffect, useState } from 'react';
import Plot from 'react-plotly.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BarChart3, Activity, Thermometer, Zap, HardDrive } from 'lucide-react';

interface HeatmapData {
  hosts: string[];
  timestamps: string[];
  metrics: {
    utilization: number[][];
    temperature: number[][];
    power: number[][];
    memory: number[][];
  };
}

type MetricType = keyof HeatmapData['metrics'];

const metricConfig: Record<MetricType, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>; 
  colorscale: string;
  unit: string;
}> = {
  utilization: {
    label: 'GPU Utilization',
    icon: Activity,
    colorscale: 'Viridis',
    unit: '%',
  },
  temperature: {
    label: 'Temperature',
    icon: Thermometer,
    colorscale: 'Hot',
    unit: '°C',
  },
  power: {
    label: 'Power Usage',
    icon: Zap,
    colorscale: 'Electric',
    unit: 'W',
  },
  memory: {
    label: 'Memory Usage',
    icon: HardDrive,
    colorscale: 'Blues',
    unit: '%',
  },
};

export function GPU3DHeatmap({ data }: { data?: HeatmapData }) {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('utilization');
  const [plotData, setPlotData] = useState<any[]>([]);
  
  // Generate demo data if none provided
  const generateDemoData = (): HeatmapData => {
    const hosts = ['Server-1', 'Server-2', 'Server-3', 'Server-4', 'Server-5'];
    const timestamps = Array.from({ length: 24 }, (_, i) => {
      const date = new Date();
      date.setHours(date.getHours() - (23 - i));
      return date.toLocaleTimeString();
    });
    
    const generateMetricData = (baseValue: number, variation: number) => {
      return hosts.map(() =>
        timestamps.map(() => baseValue + Math.random() * variation - variation / 2)
      );
    };
    
    return {
      hosts,
      timestamps,
      metrics: {
        utilization: generateMetricData(70, 40),
        temperature: generateMetricData(65, 20),
        power: generateMetricData(350, 100),
        memory: generateMetricData(60, 30),
      },
    };
  };
  
  useEffect(() => {
    // Only use demo data if no data is provided
    const heatmapData = data || (data === null ? generateDemoData() : null);
    if (!heatmapData) return;
    
    const config = metricConfig[selectedMetric];
    
    // Create 3D surface plot data
    const surface = {
      type: 'surface',
      x: heatmapData.timestamps,
      y: heatmapData.hosts,
      z: heatmapData.metrics[selectedMetric],
      colorscale: config.colorscale,
      showscale: true,
      colorbar: {
        title: {
          text: config.unit,
          side: 'right',
        },
        thickness: 20,
        len: 0.5,
      },
      hovertemplate: 
        '<b>Host:</b> %{y}<br>' +
        '<b>Time:</b> %{x}<br>' +
        `<b>${config.label}:</b> %{z:.1f}${config.unit}<br>` +
        '<extra></extra>',
    };
    
    // Add contour projection on the bottom
    const contour = {
      type: 'contour',
      x: heatmapData.timestamps,
      y: heatmapData.hosts,
      z: heatmapData.metrics[selectedMetric],
      colorscale: config.colorscale,
      showscale: false,
      contours: {
        coloring: 'heatmap',
      },
      opacity: 0.3,
    };
    
    setPlotData([surface]);
  }, [selectedMetric, data]);
  
  const layout = {
    title: {
      text: `GPU Cluster ${metricConfig[selectedMetric].label} Over Time`,
      font: { size: 16 },
    },
    scene: {
      xaxis: {
        title: 'Time',
        tickangle: -45,
        gridcolor: 'rgba(128, 128, 128, 0.2)',
      },
      yaxis: {
        title: 'Host',
        gridcolor: 'rgba(128, 128, 128, 0.2)',
      },
      zaxis: {
        title: metricConfig[selectedMetric].label,
        gridcolor: 'rgba(128, 128, 128, 0.2)',
      },
      camera: {
        eye: { x: 1.5, y: 1.5, z: 1.5 },
        center: { x: 0, y: 0, z: 0 },
      },
      aspectmode: 'manual',
      aspectratio: { x: 2, y: 1, z: 1 },
    },
    margin: { l: 0, r: 0, b: 0, t: 40 },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    height: 600,
    autosize: true,
    showlegend: false,
  };
  
  const config = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
    responsive: true,
  };
  
  // Show empty state when no data
  if (!data && plotData.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            3D GPU Cluster Heatmap
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2">📊</div>
              <div className="text-lg font-medium mb-2">No heatmap data available</div>
              <div className="text-sm text-muted-foreground">
                Historical GPU metrics will appear here once data is collected
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            3D GPU Cluster Heatmap
          </CardTitle>
          
          <Select value={selectedMetric} onValueChange={(value) => setSelectedMetric(value as MetricType)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(metricConfig).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <SelectItem key={key} value={key}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      <span>{config.label}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="w-full">
          <Plot
            data={plotData}
            layout={layout}
            config={config}
            style={{ width: '100%', height: '600px' }}
            useResizeHandler={true}
          />
        </div>
        
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.entries(metricConfig).map(([key, config]) => {
            const Icon = config.icon;
            const isSelected = key === selectedMetric;
            return (
              <button
                key={key}
                onClick={() => setSelectedMetric(key as MetricType)}
                className={`p-3 rounded-lg border transition-all ${
                  isSelected 
                    ? 'bg-primary text-primary-foreground border-primary' 
                    : 'bg-background hover:bg-accent border-border'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{config.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}