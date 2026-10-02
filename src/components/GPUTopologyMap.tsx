import React, { useCallback, useEffect, useState, Fragment } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Position,
  MarkerType,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, HardDrive, Zap, Activity, Info, Network } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useFabricLive, type FabricSnapshot } from '@/hooks/useFabricLive';
import { InfiniBandInspector } from '@/components/InfiniBandInspector';

interface TopologyHost {
  url: string;
  name: string;
}

interface TopologyLiveHost extends TopologyHost {
  gpus: Array<{
    uuid?: string;
    utilization: number;
    memory: { used: number; total: number };
    temperature: number;
    power: { draw: number; limit: number };
  }>;
}

interface GPUTopologyData {
  gpus: Array<{
    id: string;
    name: string;
    host: string;
    utilization: number;
    memory: { used: number; total: number };
    temperature: number;
    power: { draw: number; limit: number };
    connections: Array<{
      target: string;
      type: string;
      bandwidth: number;
      description?: string;
    }>;
    uuid?: string;
    nic_connections?: Array<{
      nic_id: string;
      nic_name: string;
      connection_type: string;
      description: string;
    }>;
  }>;
  mellanoxFabric?: boolean;
}

interface GPUNodeData {
  label: string;
  gpu: GPUTopologyData['gpus'][0];
  position?: 'left' | 'right' | 'single';
}

interface HostNodeData {
  label: string;
  hostname: string;
  gpus: GPUTopologyData['gpus'];
  hasMellanox: boolean;
  fabricSourcePosition: Position;
  fabricUtilization?: number;
  fabricActive: boolean;
}

interface FabricNodeData {
  label: string;
  type: string;
  hostCount: number;
}

const nodeTypes = {
  gpu: ({ data }: { data: GPUNodeData }) => {
    const memoryPercent = (data.gpu.memory.used / data.gpu.memory.total) * 100;
    const powerPercent = (data.gpu.power.draw / data.gpu.power.limit) * 100;
    
    // Check if this GPU has Mellanox connections
    const hasMellanox = data.gpu.nic_connections && 
      data.gpu.nic_connections.some(nic => nic.nic_name.toLowerCase().includes('mlx'));
    
    // Determine handle positions based on GPU position
    const showLeftHandle = data.position === 'right' || data.position === 'single';
    const showRightHandle = data.position === 'left' || data.position === 'single';
    
    return (
      <TooltipProvider>
        <div className="bg-card border-2 border-primary rounded-lg p-3 min-w-[240px] shadow-lg relative">
          {showLeftHandle && <Handle type="target" position={Position.Left} className="w-3 h-3" />}
          {showRightHandle && <Handle type="source" position={Position.Right} className="w-3 h-3" />}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{data.gpu.name}</span>
            </div>
            <Badge variant={data.gpu.utilization > 80 ? "destructive" : "default"}>
              {data.gpu.utilization}%
            </Badge>
          </div>
          
          <div className="space-y-1 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Host:</span>
              <span className="font-mono">{data.gpu.host}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Memory:</span>
              <div className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" />
                <span>{memoryPercent.toFixed(1)}%</span>
                <span className="text-muted-foreground">
                  ({(data.gpu.memory.used / 1024).toFixed(1)}/{(data.gpu.memory.total / 1024).toFixed(1)} GB)
                </span>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Temp:</span>
              <div className="flex items-center gap-1">
                <Activity className="h-3 w-3" />
                <span className={data.gpu.temperature > 80 ? "text-orange-500" : ""}>{data.gpu.temperature}°C</span>
              </div>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Power:</span>
              <div className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                <span>{data.gpu.power.draw}W / {data.gpu.power.limit}W</span>
              </div>
            </div>
            
            {hasMellanox && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Network:</span>
                <div className="flex items-center gap-1">
                  <Network className="h-3 w-3 text-blue-500" />
                  <span className="text-blue-500">Mellanox</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="mt-2 pt-2 border-t">
            <div className="w-full bg-secondary rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${data.gpu.utilization}%` }}
              />
            </div>
          </div>
          
          {data.gpu.nic_connections && data.gpu.nic_connections.length > 0 && (
            <div className="mt-2 pt-2 border-t">
              <div className="text-xs text-muted-foreground">
                NICs: {data.gpu.nic_connections.map(nic => nic.nic_name).join(', ')}
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  },
  
  host: ({ data }: { data: HostNodeData }) => {
    // Get NIC details from the first GPU with NIC connections
    const gpuWithNic = data.gpus.find(gpu => gpu.nic_connections && gpu.nic_connections.length > 0);
    const nicDetails = gpuWithNic?.nic_connections?.[0];
    
    return (
      <div className="bg-card/80 border-2 border-primary/40 rounded-xl p-3 min-w-[500px] shadow-xl">
        {data.hasMellanox && (
          <Handle 
            type="source" 
            position={data.fabricSourcePosition}
            id="mellanox"
            className="w-3 h-3 bg-purple-500"
          />
        )}
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="h-5 w-5 text-blue-400" />
          <div className="min-w-0">
            <div className="font-bold text-base text-foreground truncate">{data.hostname}</div>
            <div className="font-mono text-[10px] text-muted-foreground">{data.label}</div>
          </div>
          {data.fabricUtilization !== undefined && (
            <Badge
              variant="outline"
              className={data.fabricActive
                ? data.fabricUtilization >= 80
                  ? "bg-red-500/15 text-red-400 border-red-400/50"
                  : data.fabricUtilization >= 50
                    ? "bg-amber-500/15 text-amber-400 border-amber-400/50"
                    : "bg-violet-500/15 text-violet-300 border-violet-400/50"
                : "text-muted-foreground"}
            >
              Fabric {data.fabricUtilization.toFixed(0)}%
            </Badge>
          )}
          {data.hasMellanox && nicDetails && (
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="bg-purple-500/20 text-purple-400 dark:text-purple-200 border-purple-400">
                <Network className="h-3 w-3 mr-1" />
                {nicDetails.nic_name}
              </Badge>
              <Badge variant="outline" className="bg-purple-500/10 text-purple-500 dark:text-purple-300 border-purple-400/50 text-xs">
                {nicDetails.connection_type === 'NODE' ? 'PCIe Direct' : 
                 nicDetails.connection_type === 'SYS' ? 'Cross-Socket' :
                 nicDetails.connection_type === 'PHB' ? 'Host Bridge' :
                 nicDetails.connection_type}
              </Badge>
            </div>
          )}
        </div>
        <div className="flex gap-2 justify-center items-center">
          {data.gpus.map((gpu, index) => {
            const memoryPercent = (gpu.memory.used / gpu.memory.total) * 100;
            const position = data.gpus.length === 1 ? 'single' : (index === 0 ? 'left' : 'right');
            
            // Get interconnect type to next GPU
            let interconnectInfo = null;
            if (index === 0 && data.gpus.length > 1) {
              const connectionToNext = gpu.connections?.find(c => c.target === data.gpus[1].id);
              if (connectionToNext) {
                interconnectInfo = {
                  type: connectionToNext.type,
                  bandwidth: connectionToNext.bandwidth,
                };
              }
            }
            
            return (
              <React.Fragment key={gpu.id}>
                <div className="relative">
                  {/* Internal GPU card */}
                  <div className="bg-card border border-border rounded-lg p-2.5 min-w-[205px]">
                  {/* GPU-to-GPU handles */}
                  {position === 'left' && (
                    <Handle 
                      type="source" 
                      position={Position.Right} 
                      id={`${gpu.id}-right`}
                      className="w-2 h-2 bg-green-500" 
                      style={{ top: '50%' }}
                    />
                  )}
                  {position === 'right' && (
                    <Handle 
                      type="target" 
                      position={Position.Left} 
                      id={`${gpu.id}-left`}
                      className="w-2 h-2 bg-green-500" 
                      style={{ top: '50%' }}
                    />
                  )}
                  
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">{gpu.name}</span>
                    </div>
                    <Badge variant={gpu.utilization > 80 ? "destructive" : "default"}>
                      {gpu.utilization}%
                    </Badge>
                  </div>
                  
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Memory:</span>
                      <span>{memoryPercent.toFixed(1)}% ({(gpu.memory.used / 1024).toFixed(1)}GB)</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Temp:</span>
                      <span className={gpu.temperature > 80 ? "text-orange-500" : ""}>{gpu.temperature}°C</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Power:</span>
                      <span>{gpu.power.draw}W</span>
                    </div>
                  </div>
                  
                  <div className="mt-2 pt-2 border-t">
                    <div className="w-full bg-secondary rounded-full h-1.5">
                      <div 
                        className="bg-primary h-1.5 rounded-full transition-all"
                        style={{ width: `${gpu.utilization}%` }}
                      />
                    </div>
                  </div>
                </div>
                </div>
                
                {/* Show interconnect label between GPUs */}
                {interconnectInfo && index === 0 && (
                  <div className="flex flex-col items-center justify-center px-2">
                    <div className="text-xs text-muted-foreground mb-1">↔</div>
                    <Badge variant="secondary" className="text-xs px-2 py-0.5">
                      {interconnectInfo.type}
                    </Badge>
                    <div className="text-xs text-muted-foreground mt-1">
                      {interconnectInfo.bandwidth} GB/s
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    );
  },
  
  fabric: ({ data }: { data: FabricNodeData }) => {
    return (
      <div className="bg-gradient-to-br from-purple-600/20 to-blue-600/20 dark:from-purple-600/30 dark:to-blue-600/30 border-2 border-purple-500 rounded-2xl p-6 min-w-[180px] min-h-[180px] shadow-2xl flex flex-col items-center justify-center backdrop-blur-sm">
        <Handle type="target" position={Position.Left} id="fabric-left-top" className="w-3 h-3 bg-purple-500" style={{ top: "30%" }} />
        <Handle type="target" position={Position.Left} id="fabric-left-bottom" className="w-3 h-3 bg-purple-500" style={{ top: "70%" }} />
        <Handle type="target" position={Position.Right} id="fabric-right-top" className="w-3 h-3 bg-purple-500" style={{ top: "30%" }} />
        <Handle type="target" position={Position.Right} id="fabric-right-bottom" className="w-3 h-3 bg-purple-500" style={{ top: "70%" }} />
        <div className="absolute top-0 left-0 w-full h-full rounded-2xl bg-gradient-to-br from-purple-400/5 to-blue-400/5 dark:from-purple-400/10 dark:to-blue-400/10 animate-pulse" />
        <Network className="h-14 w-14 text-purple-400 mb-3 relative z-10" />
        <span className="font-bold text-xl text-purple-700 dark:text-purple-100 relative z-10">{data.label}</span>
        <span className="text-sm text-purple-600 dark:text-purple-200 mt-1 relative z-10">{data.type}</span>
        <div className="mt-2 text-xs text-purple-500 dark:text-purple-300 relative z-10">High-Speed Interconnect</div>
      </div>
    );
  },
};

// Connection type styles with descriptions
const connectionStyles = {
  'NVLink': {
    strokeWidth: 4,
    stroke: 'var(--topo-nvlink)',
    animated: true,
    label: 'NVLink',
    description: 'High-speed GPU interconnect'
  },
  'PCIe-SYS': {
    strokeWidth: 2,
    stroke: 'var(--topo-pcie-sys)',
    animated: false,
    label: 'PCIe (Cross-socket)',
    description: 'PCIe traversing NUMA nodes'
  },
  'PCIe-NODE': {
    strokeWidth: 2,
    stroke: 'var(--topo-pcie-node)',
    animated: false,
    label: 'PCIe (NUMA)',
    description: 'PCIe within NUMA node'
  },
  'PCIe-PHB': {
    strokeWidth: 2,
    stroke: 'var(--topo-pcie-phb)',
    animated: false,
    label: 'PCIe (Host Bridge)',
    description: 'PCIe through Host Bridge'
  },
  'PCIe-PIX': {
    strokeWidth: 2,
    stroke: 'var(--topo-pcie-pix)',
    animated: false,
    label: 'PCIe (Switch)',
    description: 'PCIe through single switch'
  },
  'Mellanox': {
    strokeWidth: 3,
    stroke: 'var(--topo-fabric)',
    animated: true,
    strokeDasharray: '5 5',
    label: 'AI Fabric',
    description: 'High-speed AI cluster interconnect'
  },
  'default': {
    strokeWidth: 2,
    stroke: 'var(--topo-default)',
    animated: false,
    label: 'Connection',
    description: 'Network connection'
  }
};

function fabricPosition(hostCount: number) {
  if (hostCount <= 1) return { x: 620, y: 100 };
  return { x: 500, y: 180 };
}

function hostPlacement(index: number) {
  const layout = [
    { x: 0, y: 0, source: Position.Right, target: "fabric-left-top" },
    { x: 600, y: 0, source: Position.Left, target: "fabric-right-top" },
    { x: 0, y: 360, source: Position.Right, target: "fabric-left-bottom" },
    { x: 600, y: 360, source: Position.Left, target: "fabric-right-bottom" },
  ];
  return layout[index] || { x: (index % 2) * 600, y: 720 + Math.floor((index - 4) / 2) * 360, source: index % 2 ? Position.Left : Position.Right, target: index % 2 ? "fabric-right-bottom" : "fabric-left-bottom" };
}

function hostAddress(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/:]/)[0];
  }
}

function formatTraffic(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1e9) return `${(bytesPerSecond / 1e9).toFixed(1)} GB/s`;
  if (bytesPerSecond >= 1e6) return `${(bytesPerSecond / 1e6).toFixed(1)} MB/s`;
  if (bytesPerSecond >= 1e3) return `${(bytesPerSecond / 1e3).toFixed(1)} KB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}

function fabricTraffic(snapshot?: FabricSnapshot) {
  const ports = snapshot?.infiniband.filter((port) => port.state === "ACTIVE") || [];
  const tx = ports.reduce((sum, port) => sum + (port.rdma_available ? port.rdma_tx_bps || 0 : port.tx_bps), 0);
  const rx = ports.reduce((sum, port) => sum + (port.rdma_available ? port.rdma_rx_bps || 0 : port.rx_bps), 0);
  const capacity = ports.reduce((sum, port) => sum + (port.rate_gbps * 1e9) / 8, 0);
  const utilization = capacity > 0 ? Math.min(1, Math.max(tx, rx) / capacity) : 0;
  return { tx, rx, total: tx + rx, capacity, utilization, rdma: ports.some((port) => port.rdma_available) };
}

function usageTone(percentage: number): string {
  if (percentage >= 80) return "bg-red-500 text-red-100";
  if (percentage >= 50) return "bg-amber-500 text-amber-950";
  if (percentage > 0) return "bg-violet-500 text-violet-50";
  return "bg-muted text-muted-foreground";
}

function linkColor(percentage: number): string {
  if (percentage >= 80) return "#ef4444";
  if (percentage >= 50) return "#f59e0b";
  if (percentage > 0) return "#a855f7";
  return "#64748b";
}

function graphPlacement(index: number, count: number) {
  if (count <= 1) return { x: 150, y: 170 };
  if (count === 2) return index === 0 ? { x: 180, y: 170 } : { x: 820, y: 170 };
  const placements = [
    { x: 180, y: 80 },
    { x: 820, y: 80 },
    { x: 180, y: 260 },
    { x: 820, y: 260 },
  ];
  return placements[index] || { x: 180 + (index % 2) * 640, y: 260 + Math.floor(index / 2) * 120 };
}

export function GPUTopologyMap({
  data,
  hosts = [],
  liveHosts = [],
}: {
  data?: GPUTopologyData;
  hosts?: TopologyHost[];
  liveHosts?: TopologyLiveHost[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [selectedHostUrl, setSelectedHostUrl] = useState<string | null>(null);
  const fabricResults = useFabricLive(hosts);
  const fabricSignature = fabricResults.map((result) => {
    const traffic = fabricTraffic(result.data);
    return `${result.hostUrl}:${traffic.tx}:${traffic.rx}`;
  }).join("|");
  const fabricByHost = new Map(
    fabricResults.map((result) => [hostAddress(result.hostUrl), result.data])
  );
  const liveSignature = liveHosts.flatMap((host) => host.gpus.map((gpu) =>
    `${host.url}:${gpu.uuid}:${gpu.utilization}:${gpu.memory.used}:${gpu.temperature}:${gpu.power.draw}`
  )).join("|");
  
  useEffect(() => {
    if (!data || !data.gpus) return;
    const liveByHost = new Map(liveHosts.map((host) => [hostAddress(host.url), host]));
    const topologyGpus = data.gpus.map((gpu) => {
      const liveGpu = liveByHost.get(gpu.host)?.gpus.find((candidate) => candidate.uuid && candidate.uuid === gpu.uuid);
      return liveGpu ? {
        ...gpu,
        utilization: liveGpu.utilization,
        memory: liveGpu.memory,
        temperature: liveGpu.temperature,
        power: liveGpu.power,
      } : gpu;
    });
    
    // Group GPUs by host
    const hostGroups = topologyGpus.reduce((acc, gpu) => {
      if (!acc[gpu.host]) acc[gpu.host] = [];
      acc[gpu.host].push(gpu);
      return acc;
    }, {} as Record<string, typeof data.gpus>);
    
    const topologyHosts = Object.keys(hostGroups);
    const hasMellanoxFabric = data.mellanoxFabric || false;
    
    // Detect fabric type (InfiniBand or RoCEv2)
    let fabricType = 'InfiniBand/RoCEv2';
    const firstGpuWithNic = topologyGpus.find(gpu =>
      gpu.nic_connections && gpu.nic_connections.length > 0
    );
    if (firstGpuWithNic && firstGpuWithNic.nic_connections) {
      const nicName = firstGpuWithNic.nic_connections[0].nic_name.toLowerCase();
      if (nicName.includes('ib') || nicName.includes('infiniband')) {
        fabricType = 'InfiniBand';
      } else if (nicName.includes('roce')) {
        fabricType = 'RoCEv2';
      }
    }
    
    // Create nodes
    const newNodes: Node[] = [];
    
    // Add AI fabric cloud in the center if present
    if (hasMellanoxFabric) {
      newNodes.push({
        id: 'mellanox-fabric',
        type: 'fabric',
        position: fabricPosition(topologyHosts.length),
        data: {
          label: 'AI Fabric',
          type: fabricType,
          hostCount: topologyHosts.length,
        },
      });
    }
    
    // Create host nodes with embedded GPUs
    // Position hosts in a circle around the center, with more spacing
    topologyHosts.forEach((host, hostIndex) => {
      const gpusInHost = hostGroups[host];
      const placement = hostPlacement(hostIndex);
      
      // Check if this host has Mellanox NICs
      const hostHasMellanox = gpusInHost.some(gpu => 
        gpu.nic_connections && gpu.nic_connections.some(nic => 
          nic.nic_name.toLowerCase().includes('mlx')
        )
      );
      
      const configuredHost = hosts.find((candidate) => hostAddress(candidate.url) === host);
      const traffic = fabricTraffic(fabricByHost.get(host));
      const hostDisplayName = configuredHost?.name || host;
      
      newNodes.push({
        id: `host-${host}`,
        type: 'host',
        position: { x: placement.x, y: placement.y },
        data: {
          label: host,
          hostname: hostDisplayName,
          gpus: gpusInHost,
          hasMellanox: hostHasMellanox,
          fabricSourcePosition: placement.source,
          fabricUtilization: traffic.utilization * 100,
          fabricActive: traffic.total > 0,
        },
      });
    });
    
    // Create edges
    const newEdges: Edge[] = [];
    const edgeSet = new Set<string>(); // To avoid duplicate edges
    
    // Create internal GPU-to-GPU connections within each host
    topologyHosts.forEach((host) => {
      const gpusInHost = hostGroups[host];
      
      // Find GPU-to-GPU connections within the same host
      gpusInHost.forEach((gpu) => {
        gpu.connections?.forEach((conn) => {
          // Check if target GPU is in the same host
          const targetGpu = topologyGpus.find(g => g.id === conn.target);
          if (targetGpu && targetGpu.host === gpu.host) {
            const edgeId = `internal-${gpu.id}-${conn.target}`;
            const reverseEdgeId = `internal-${conn.target}-${gpu.id}`;
            
            if (!edgeSet.has(edgeId) && !edgeSet.has(reverseEdgeId)) {
              edgeSet.add(edgeId);
              
              const style = connectionStyles[conn.type] || 
                           connectionStyles[conn.type.split('-')[0]] || 
                           connectionStyles.default;
              
              // Determine which handles to use based on GPU positions
              const sourceIndex = gpusInHost.findIndex(g => g.id === gpu.id);
              const targetIndex = gpusInHost.findIndex(g => g.id === conn.target);
              
              const sourceHandle = sourceIndex < targetIndex ? `${gpu.id}-right` : null;
              const targetHandle = sourceIndex < targetIndex ? `${conn.target}-left` : null;
              
              if (sourceHandle && targetHandle) {
                newEdges.push({
                  id: edgeId,
                  source: `host-${host}`,
                  target: `host-${host}`,
                  sourceHandle,
                  targetHandle,
                  type: 'straight',
                  animated: false,
                  style: {
                    stroke: style.stroke,
                    strokeWidth: style.strokeWidth,
                    strokeDasharray: style.strokeDasharray,
                    opacity: 0.55,
                  },
                  data: {
                    type: conn.type,
                    bandwidth: conn.bandwidth,
                    description: conn.description || style.description,
                  },
                });
              }
            }
          }
        });
      });
    });
    
    // Create connections from hosts to Mellanox fabric
    if (hasMellanoxFabric) {
      topologyHosts.forEach((host, hostIndex) => {
        const gpusInHost = hostGroups[host];
        const placement = hostPlacement(hostIndex);
        const hostHasMellanox = gpusInHost.some(gpu => 
          gpu.nic_connections && gpu.nic_connections.some(nic => 
            nic.nic_name.toLowerCase().includes('mlx')
          )
        );
        
        if (hostHasMellanox) {
          const edgeId = `fabric-${host}`;
          const configuredHost = hosts.find((candidate) => hostAddress(candidate.url) === host);
          const style = connectionStyles['Mellanox'];
          const traffic = fabricTraffic(fabricByHost.get(host));
          const active = traffic.total > 0;
          const usagePercent = traffic.utilization * 100;
          const stroke = !active
            ? style.stroke
            : usagePercent >= 80
              ? 'hsl(0 84% 60%)'
              : usagePercent >= 50
                ? 'hsl(38 92% 55%)'
                : 'hsl(271 91% 65%)';
          const trafficLabel = active
            ? `${traffic.rdma ? 'RDMA ' : ''}${formatTraffic(traffic.total)} · ${usagePercent.toFixed(0)}%`
            : 'No traffic sampled';
          
          newEdges.push({
            id: edgeId,
            source: `host-${host}`,
            target: 'mellanox-fabric',
            sourceHandle: 'mellanox',
            targetHandle: placement.target,
            type: 'smoothstep',
            animated: active,
            style: {
              stroke,
              strokeWidth: active ? Math.min(10, 3 + traffic.total / 250_000_000) : style.strokeWidth,
              strokeDasharray: style.strokeDasharray,
              opacity: active ? 1 : 0.45,
            },
            label: trafficLabel,
            labelStyle: { 
              fontSize: 12, 
              fontWeight: 700,
              fill: stroke,
            },
            labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.95 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: stroke,
            },
            data: {
              type: 'Mellanox',
              bandwidth: 100,
              hostUrl: configuredHost?.url,
              traffic,
              description: active
                ? 'Live host-to-fabric transport rate. Peer-level attribution is inferred.'
                : 'Active fabric path with no traffic sampled in the current interval.',
            },
          });
        }
      });
    }
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [data, fabricSignature, liveSignature, setNodes, setEdges]);
  
  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );
  
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge.id);
    const hostUrl = typeof edge.data?.hostUrl === "string" ? edge.data.hostUrl : null;
    if (hostUrl) setSelectedHostUrl(hostUrl);
    setTimeout(() => setSelectedEdge(null), 3000);
  }, []);

  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    if (!node.id.startsWith("host-")) return;
    const hostAddressValue = String(node.data.label || "");
    const configuredHost = hosts.find((host) => hostAddress(host.url) === hostAddressValue);
    if (configuredHost) setSelectedHostUrl(configuredHost.url);
  }, [hosts]);
  
  // Show loading or empty state when no data
  if (!data || !data.gpus || data.gpus.length === 0) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            GPU Topology Map
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-2xl mb-2">🔍</div>
              <div className="text-lg font-medium mb-2">No GPU topology data available</div>
              <div className="text-sm text-muted-foreground">
                Waiting for GPU hosts to report topology information...
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const selectedHost = hosts.find((host) => host.url === selectedHostUrl);
  const selectedSnapshot = fabricResults.find((result) => result.hostUrl === selectedHostUrl)?.data;

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="border-b bg-card/60 pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Cpu className="h-5 w-5" />
          GPU Topology Map
          {data.mellanoxFabric && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Network className="h-3 w-3" />
              Live fabric traffic
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 lg:p-6">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-[820px] min-w-0 rounded-xl border bg-background">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              nodeTypes={nodeTypes}
              defaultViewport={{ x: 56, y: 48, zoom: 0.8 }}
              minZoom={0.3}
              attributionPosition="bottom-left"
            >
              <Background variant="dots" gap={12} size={1} />
              <Controls />
            </ReactFlow>
          </div>
          <InfiniBandInspector hostName={selectedHost?.name} hostUrl={selectedHost?.url} snapshot={selectedSnapshot} onClose={() => setSelectedHostUrl(null)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Fabric links are color-coded by utilization: violet low, amber moderate, red high. Select a host or fabric link for full InfiniBand port diagnostics.</p>
      </CardContent>
    </Card>
  );

  const liveByHost = new Map(liveHosts.map((host) => [hostAddress(host.url), host]));
  const displayGpus = data.gpus.map((gpu) => {
    const liveGpu = liveByHost.get(gpu.host)?.gpus.find((candidate) => candidate.uuid && candidate.uuid === gpu.uuid);
    return liveGpu ? { ...gpu, utilization: liveGpu.utilization, memory: liveGpu.memory, temperature: liveGpu.temperature, power: liveGpu.power } : gpu;
  });
  const hostGroups = displayGpus.reduce((groups, gpu) => {
    (groups[gpu.host] ||= []).push(gpu);
    return groups;
  }, {} as Record<string, typeof displayGpus>);

  return (
    <Card className="w-full overflow-hidden">
      <CardHeader className="border-b bg-card/60 pb-4">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Cpu className="h-5 w-5" />
          GPU Topology
          {data.mellanoxFabric && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Network className="h-3 w-3" />
              Fabric telemetry live
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 p-4 lg:p-6">
        <div className="overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_center,hsl(var(--muted)/0.5),transparent_65%)] p-2">
          <svg viewBox="0 0 1000 360" className="h-auto w-full" role="img" aria-label="Live GPU fabric topology">
            <defs>
              <filter id="fabric-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            {Object.keys(hostGroups).map((host, index, allHosts) => {
              const placement = graphPlacement(index, allHosts.length);
              const configuredHost = hosts.find((candidate) => hostAddress(candidate.url) === host);
              const traffic = fabricTraffic(fabricByHost.get(host));
              const percentage = traffic.utilization * 100;
              const color = linkColor(percentage);
              const trafficLabel = traffic.total > 0 ? `${formatTraffic(traffic.total)} · ${percentage.toFixed(0)}%` : "No traffic";
              const midX = (placement.x + 500) / 2;
              const midY = (placement.y + 180) / 2;
              return (
                <g key={host}>
                  <path
                    d={`M ${placement.x} ${placement.y} Q ${midX} ${placement.y} 500 180`}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.min(10, 2 + percentage / 12)}
                    strokeDasharray={traffic.total > 0 ? undefined : "6 6"}
                    vectorEffect="non-scaling-stroke"
                    filter={traffic.total > 0 ? "url(#fabric-glow)" : undefined}
                  />
                  <text x={midX} y={midY - 8} textAnchor="middle" fill={color} fontSize="13" fontWeight="700">
                    {trafficLabel}
                  </text>
                  <rect x={placement.x - 95} y={placement.y - 30} width="190" height="60" rx="10" fill="hsl(var(--card))" stroke={color} strokeWidth="2" />
                  <text x={placement.x} y={placement.y - 5} textAnchor="middle" fill="hsl(var(--foreground))" fontSize="15" fontWeight="700">
                    {configuredHost?.name || host}
                  </text>
                  <text x={placement.x} y={placement.y + 15} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="12">
                    {host}
                  </text>
                </g>
              );
            })}
            <rect x="420" y="125" width="160" height="110" rx="16" fill="hsl(271 91% 65% / 0.16)" stroke="hsl(271 91% 65%)" strokeWidth="2" />
            <text x="500" y="165" textAnchor="middle" fill="hsl(271 91% 75%)" fontSize="24" fontWeight="700">AI Fabric</text>
            <text x="500" y="190" textAnchor="middle" fill="hsl(271 91% 80%)" fontSize="14">InfiniBand / RoCEv2</text>
            <text x="500" y="212" textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="12">Live RDMA paths</text>
          </svg>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_250px]">
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(hostGroups).map(([host, gpus]) => {
              const configuredHost = hosts.find((candidate) => hostAddress(candidate.url) === host);
              const traffic = fabricTraffic(fabricByHost.get(host));
              const percentage = traffic.utilization * 100;
              const firstGpu = gpus[0];
              const nic = firstGpu?.nic_connections?.map((connection) => connection.nic_name).join(", ");
              const localPath = firstGpu?.connections?.find((connection) => gpus.some((gpu) => gpu.id === connection.target));

              return (
                <section key={host} className="rounded-xl border bg-background/50 p-4 shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">{configuredHost?.name || host}</h3>
                      <p className="font-mono text-xs text-muted-foreground">{host}</p>
                    </div>
                    <Badge className={`${usageTone(percentage)} shrink-0 text-xs`}>
                      Fabric {percentage.toFixed(0)}%
                    </Badge>
                  </div>

                  <div className="mb-4 grid grid-cols-2 gap-3">
                    {gpus.map((gpu) => (
                      <div key={gpu.id} className="rounded-lg border bg-card p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{gpu.name}</span>
                          <Badge variant={gpu.utilization >= 80 ? "destructive" : "secondary"} className="text-[11px]">
                            {gpu.utilization.toFixed(0)}%
                          </Badge>
                        </div>
                        <dl className="space-y-1 text-xs">
                          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Memory</dt><dd>{gpu.memory.used.toFixed(0)} / {gpu.memory.total.toFixed(0)} MiB</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Temperature</dt><dd>{gpu.temperature.toFixed(0)}°C</dd></div>
                          <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Power</dt><dd>{gpu.power.draw.toFixed(0)} W</dd></div>
                        </dl>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, gpu.utilization)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                    {localPath && <span>Local path: <span className="font-medium text-foreground">{localPath.type} · {localPath.bandwidth} GB/s</span></span>}
                    {nic && <span>NIC: <span className="font-medium text-foreground">{nic}</span></span>}
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="rounded-xl border bg-muted/30 p-4 lg:sticky lg:top-4 lg:h-fit">
            <div className="mb-4 flex items-center gap-2">
              <Network className="h-4 w-4 text-violet-400" />
              <h3 className="font-semibold">Fabric activity</h3>
            </div>
            <p className="mb-5 text-xs leading-relaxed text-muted-foreground">Live RDMA transport per host. Utilization uses the busiest direction against negotiated link capacity.</p>
            <div className="space-y-4">
              {Object.keys(hostGroups).map((host) => {
                const configuredHost = hosts.find((candidate) => hostAddress(candidate.url) === host);
                const traffic = fabricTraffic(fabricByHost.get(host));
                const percentage = traffic.utilization * 100;
                return (
                  <div key={host} className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{configuredHost?.name || host}</span>
                      <span className="font-mono text-muted-foreground">{percentage.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={usageTone(percentage).split(" ")[0]} style={{ width: `${percentage}%`, height: "100%" }} />
                    </div>
                    <div className="flex justify-between gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>{traffic.total > 0 ? formatTraffic(traffic.total) : "No traffic"}</span>
                      <span>{traffic.capacity > 0 ? `${formatTraffic(traffic.capacity)} / dir` : "No active port"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}