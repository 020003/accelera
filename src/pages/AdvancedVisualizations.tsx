import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { GPUTopologyMap } from '@/components/GPUTopologyMap';
import { GPU3DHeatmap } from '@/components/GPU3DHeatmap';
import { AIWorkloadTimeline } from '@/components/AIWorkloadTimeline';
import { NetworkIcon, BarChart3, Clock, TrendingUp, Cpu, Bot } from 'lucide-react';
import { toast } from 'sonner';

export default function AdvancedVisualizations() {
  const [topologyData, setTopologyData] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [timelineData, setTimelineData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('topology');

  // Fetch topology data
  const fetchTopologyData = async () => {
    try {
      const response = await fetch('/api/topology');
      if (response.ok) {
        const data = await response.json();
        setTopologyData(data);
      }
    } catch (error) {
      console.error('Error fetching topology data:', error);
      toast.error('Failed to load topology data');
    }
  };

  // Fetch heatmap data
  const fetchHeatmapData = async () => {
    try {
      const response = await fetch('/api/heatmap?metric=utilization&hours=24');
      if (response.ok) {
        const data = await response.json();
        setHeatmapData(data);
      }
    } catch (error) {
      console.error('Error fetching heatmap data:', error);
      toast.error('Failed to load heatmap data');
    }
  };

  // Fetch timeline data
  const fetchTimelineData = async () => {
    try {
      const response = await fetch('/api/timeline');
      if (response.ok) {
        const data = await response.json();
        setTimelineData(data);
      }
    } catch (error) {
      console.error('Error fetching timeline data:', error);
      toast.error('Failed to load timeline data');
    }
  };

  // Load all data
  const loadAllData = async () => {
    setIsLoading(true);
    await Promise.all([
      fetchTopologyData(),
      fetchHeatmapData(),
      fetchTimelineData(),
    ]);
    setIsLoading(false);
  };

  useEffect(() => {
    loadAllData();
    
    // Refresh data every 30 seconds
    const interval = setInterval(loadAllData, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Helmet>
        <title>Advanced Visualizations - GPU Monitor</title>
        <meta name="description" content="Advanced GPU monitoring visualizations including topology maps, 3D heatmaps, and AI workload timelines." />
      </Helmet>

      {/* Header */}
      <header className="navbar">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary/10 rounded-lg">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">Advanced Visualizations</h1>
                <p className="text-sm text-muted-foreground">
                  Comprehensive GPU cluster analysis and AI workload monitoring
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                Multi-Host Analysis
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1">
                <Bot className="h-3 w-3" />
                AI Workload Tracking
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                <span>Loading advanced visualizations...</span>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="topology" className="flex items-center gap-2">
                <NetworkIcon className="h-4 w-4" />
                GPU Topology
              </TabsTrigger>
              <TabsTrigger value="heatmap" className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                3D Heatmap
              </TabsTrigger>
              <TabsTrigger value="timeline" className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                AI Timeline
              </TabsTrigger>
            </TabsList>

            <TabsContent value="topology" className="space-y-6">
              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <NetworkIcon className="h-5 w-5" />
                      GPU Topology Overview
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">
                      Interactive network diagram showing GPU interconnections, memory hierarchy, 
                      and data flow between GPUs. Identify bottlenecks in GPU-to-GPU communication 
                      and optimize model parallelism strategies.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-500">NVLink</div>
                        <div className="text-sm text-muted-foreground">High Speed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-amber-500">SXM</div>
                        <div className="text-sm text-muted-foreground">Ultra High Speed</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-indigo-500">PCIe</div>
                        <div className="text-sm text-muted-foreground">Standard</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-primary">Real-time</div>
                        <div className="text-sm text-muted-foreground">Live Metrics</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <GPUTopologyMap data={topologyData} />
              </div>
            </TabsContent>

            <TabsContent value="heatmap" className="space-y-6">
              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      3D Cluster Heatmap Analysis
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">
                      Three-dimensional visualization showing GPU utilization patterns over time across 
                      multiple hosts. Quickly identify resource waste, anomalies, and optimization 
                      opportunities in large GPU clusters.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-500">Utilization</div>
                        <div className="text-sm text-muted-foreground">GPU Usage %</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-500">Temperature</div>
                        <div className="text-sm text-muted-foreground">Thermal °C</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-yellow-500">Power</div>
                        <div className="text-sm text-muted-foreground">Watts Draw</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-purple-500">Memory</div>
                        <div className="text-sm text-muted-foreground">VRAM Usage %</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <GPU3DHeatmap data={heatmapData} />
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-6">
              <div className="grid gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      AI Workload Timeline
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground mb-4">
                      Gantt-chart style visualization of Ollama model loading, inference requests, 
                      and GPU allocation over time. Optimize model scheduling and identify 
                      opportunities for batching or model switching.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="text-center">
                        <div className="text-2xl">📚</div>
                        <div className="text-sm text-muted-foreground">Model Loading</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl">🧠</div>
                        <div className="text-sm text-muted-foreground">Inference</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl">⚡</div>
                        <div className="text-sm text-muted-foreground">GPU Allocation</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl">🎓</div>
                        <div className="text-sm text-muted-foreground">Training</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <AIWorkloadTimeline data={timelineData} />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6">
          <div className="text-center text-sm text-muted-foreground">
            Advanced GPU monitoring visualizations powered by D3.js, Plotly.js, and React Flow
          </div>
        </div>
      </footer>
    </div>
  );
}