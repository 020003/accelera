import { lazy, Suspense } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  NetworkIcon,
  BarChart3,
  RefreshCw,
  Activity,
  Thermometer,
  Zap,
  HardDrive,
  Loader2,
} from "lucide-react";

const GPUTopologyMap = lazy(() =>
  import("@/components/GPUTopologyMap").then((m) => ({ default: m.GPUTopologyMap }))
);
const GPU3DHeatmap = lazy(() =>
  import("@/components/GPU3DHeatmap").then((m) => ({ default: m.GPU3DHeatmap }))
);

interface VisualizationsTabProps {
  topologyData: any;
  heatmapData: any;
  heatmapHours: number;
  setHeatmapHours: (h: number) => void;
  advancedDataLoaded: boolean;
  setAdvancedDataLoaded: (v: boolean) => void;
  fetchAdvancedVisualizationData: () => Promise<void>;
  vizRefreshing: boolean;
  setVizRefreshing: (v: boolean) => void;
}

function VizLoading({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center py-20">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">{text}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function VizEmpty({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <BarChart3 className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-sm">{text}</p>
      </CardContent>
    </Card>
  );
}

export function VisualizationsTab({
  topologyData,
  heatmapData,
  heatmapHours,
  setHeatmapHours,
  setAdvancedDataLoaded,
  fetchAdvancedVisualizationData,
  vizRefreshing,
  setVizRefreshing,
}: VisualizationsTabProps) {
  return (
    <Tabs defaultValue="topology" className="space-y-4">
      {/* Tab header row */}
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="topology" className="gap-1.5 text-xs">
            <NetworkIcon className="h-3.5 w-3.5" />
            GPU Topology
          </TabsTrigger>
          <TabsTrigger value="heatmap" className="gap-1.5 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Cluster Heatmap
          </TabsTrigger>
        </TabsList>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={vizRefreshing}
          onClick={async () => {
            setVizRefreshing(true);
            setAdvancedDataLoaded(false);
            await fetchAdvancedVisualizationData();
            setVizRefreshing(false);
          }}
        >
          <RefreshCw className={`h-3 w-3 ${vizRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Topology ── */}
      <TabsContent value="topology" className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: "NVLink", color: "bg-green-500", desc: "High speed" },
            { label: "SXM", color: "bg-amber-500", desc: "Ultra high speed" },
            { label: "PCIe", color: "bg-indigo-500", desc: "Standard" },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-xs">
              <div className={`w-2.5 h-2.5 rounded-full ${l.color}`} />
              <span className="font-medium">{l.label}</span>
              <span className="text-muted-foreground">{l.desc}</span>
            </div>
          ))}
        </div>
        <Suspense fallback={<VizLoading text="Loading topology..." />}>
          <GPUTopologyMap data={topologyData} />
        </Suspense>
      </TabsContent>

      {/* ── Heatmap ── */}
      <TabsContent value="heatmap" className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {[
              { icon: Activity, label: "Utilization", color: "text-blue-500" },
              { icon: Thermometer, label: "Temperature", color: "text-red-500" },
              { icon: Zap, label: "Power", color: "text-amber-500" },
              { icon: HardDrive, label: "Memory", color: "text-purple-500" },
            ].map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.label} className="flex items-center gap-1">
                  <Icon className={`h-3.5 w-3.5 ${m.color}`} />
                  <span className="text-muted-foreground">{m.label}</span>
                </div>
              );
            })}
          </div>
          <ToggleGroup
            type="single"
            value={String(heatmapHours)}
            onValueChange={(v) => {
              if (!v) return;
              setHeatmapHours(Number(v));
              setAdvancedDataLoaded(false);
            }}
            className="h-7"
          >
            {[2, 6, 12, 24].map((h) => (
              <ToggleGroupItem key={h} value={String(h)} className="text-xs px-2.5 h-7">
                {h}h
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <Suspense fallback={<VizLoading text="Loading heatmap..." />}>
          {heatmapData ? (
            <GPU3DHeatmap data={heatmapData} />
          ) : (
            <VizEmpty text="No heatmap data available. Data appears once hosts report historical metrics." />
          )}
        </Suspense>
      </TabsContent>
    </Tabs>
  );
}
