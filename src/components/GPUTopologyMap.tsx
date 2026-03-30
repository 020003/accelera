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
}

interface FabricNodeData {
  label: string;
  type: string;
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
      <div className="bg-card/80 border-2 border-primary/40 rounded-xl p-4 min-w-[600px] shadow-xl">
        {data.hasMellanox && (
          <Handle 
            type="source" 
            position={Position.Top} 
            id="mellanox"
            className="w-4 h-4 bg-purple-500" 
            style={{ left: '50%', transform: 'translateX(-50%)' }}
          />
        )}
        <div className="flex items-center gap-2 mb-3">
          <HardDrive className="h-5 w-5 text-blue-400" />
          <span className="font-bold text-lg text-foreground">Host: {data.hostname}</span>
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
        <div className="flex gap-4 justify-center items-center">
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
                  <div className="bg-card border border-border rounded-lg p-3 min-w-[240px]">
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
      <div className="bg-gradient-to-br from-purple-600/20 to-blue-600/20 dark:from-purple-600/30 dark:to-blue-600/30 border-2 border-purple-500 rounded-2xl p-8 min-w-[220px] min-h-[220px] shadow-2xl flex flex-col items-center justify-center backdrop-blur-sm">
        <Handle 
          type="target" 
          position={Position.Bottom} 
          id="fabric-in"
          className="w-4 h-4 bg-purple-500" 
          style={{ left: '50%', transform: 'translateX(-50%)' }}
        />
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

export function GPUTopologyMap({ data }: { data?: GPUTopologyData }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  
  useEffect(() => {
    if (!data || !data.gpus) return;
    
    // Group GPUs by host
    const hostGroups = data.gpus.reduce((acc, gpu) => {
      if (!acc[gpu.host]) acc[gpu.host] = [];
      acc[gpu.host].push(gpu);
      return acc;
    }, {} as Record<string, typeof data.gpus>);
    
    const hosts = Object.keys(hostGroups);
    const hostCount = hosts.length;
    const hasMellanoxFabric = data.mellanoxFabric || false;
    
    // Detect fabric type (InfiniBand or RoCEv2)
    let fabricType = 'InfiniBand/RoCEv2';
    const firstGpuWithNic = data.gpus.find(gpu => 
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
        position: { x: 500, y: 400 },
        data: {
          label: 'AI Fabric',
          type: fabricType,
        },
      });
    }
    
    // Create host nodes with embedded GPUs
    // Position hosts in a circle around the center, with more spacing
    hosts.forEach((host, hostIndex) => {
      const gpusInHost = hostGroups[host];
      const hostAngle = (2 * Math.PI * hostIndex) / hostCount - Math.PI / 2; // Start from top
      const hostRadius = 500; // Increased radius to avoid overlap
      const centerX = 500;
      const centerY = 400;
      const hostX = centerX + hostRadius * Math.cos(hostAngle);
      const hostY = centerY + hostRadius * Math.sin(hostAngle);
      
      // Check if this host has Mellanox NICs
      const hostHasMellanox = gpusInHost.some(gpu => 
        gpu.nic_connections && gpu.nic_connections.some(nic => 
          nic.nic_name.toLowerCase().includes('mlx')
        )
      );
      
      // Determine host display name
      let hostDisplayName = host;
      if (host.length === 12 && /^[a-f0-9]+$/.test(host)) {
        // Container ID — try to resolve from VITE_BACKEND_HOSTS env
        const envHosts = (import.meta.env.VITE_BACKEND_HOSTS || '').split(',').filter(Boolean);
        const backendIndex = hosts.indexOf(host);
        if (backendIndex >= 0 && backendIndex < envHosts.length) {
          const match = envHosts[backendIndex].match(/(\d+\.\d+\.\d+\.\d+)/);
          hostDisplayName = match ? match[1] : `Host ${backendIndex + 1}`;
        } else {
          hostDisplayName = `Host ${backendIndex + 1}`;
        }
      }
      
      newNodes.push({
        id: `host-${host}`,
        type: 'host',
        position: { x: hostX - 300, y: hostY - 100 },
        data: {
          label: hostDisplayName,
          hostname: hostDisplayName,
          gpus: gpusInHost,
          hasMellanox: hostHasMellanox,
        },
      });
    });
    
    // Create edges
    const newEdges: Edge[] = [];
    const edgeSet = new Set<string>(); // To avoid duplicate edges
    
    // Create internal GPU-to-GPU connections within each host
    hosts.forEach((host) => {
      const gpusInHost = hostGroups[host];
      
      // Find GPU-to-GPU connections within the same host
      gpusInHost.forEach((gpu) => {
        gpu.connections?.forEach((conn) => {
          // Check if target GPU is in the same host
          const targetGpu = data.gpus.find(g => g.id === conn.target);
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
                  animated: style.animated,
                  style: {
                    stroke: style.stroke,
                    strokeWidth: style.strokeWidth + 2,
                    strokeDasharray: style.strokeDasharray,
                  },
                  label: `${conn.bandwidth} GB/s`,
                  labelStyle: { 
                    fontSize: 11, 
                    fontWeight: 700,
                    fill: style.stroke,
                  },
                  labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.95 },
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
      hosts.forEach((host) => {
        const gpusInHost = hostGroups[host];
        const hostHasMellanox = gpusInHost.some(gpu => 
          gpu.nic_connections && gpu.nic_connections.some(nic => 
            nic.nic_name.toLowerCase().includes('mlx')
          )
        );
        
        if (hostHasMellanox) {
          const edgeId = `fabric-${host}`;
          const style = connectionStyles['Mellanox'];
          
          newEdges.push({
            id: edgeId,
            source: `host-${host}`,
            target: 'mellanox-fabric',
            sourceHandle: 'mellanox',
            targetHandle: 'fabric-in',
            type: 'smoothstep',
            animated: true,
            style: {
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              strokeDasharray: style.strokeDasharray,
            },
            label: '100 GB/s',
            labelStyle: { 
              fontSize: 12, 
              fontWeight: 700,
              fill: style.stroke,
            },
            labelBgStyle: { fill: 'hsl(var(--card))', fillOpacity: 0.95 },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: style.stroke,
            },
            data: {
              type: 'Mellanox',
              bandwidth: 100,
              description: style.description,
            },
          });
        }
      });
    }
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [data, setNodes, setEdges]);
  
  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );
  
  const onEdgeClick = useCallback((event: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge.id);
    setTimeout(() => setSelectedEdge(null), 3000);
  }, []);
  
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
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          GPU Topology Map
          {data.mellanoxFabric && (
            <Badge variant="outline" className="ml-2">
              <Network className="h-3 w-3 mr-1" />
              Mellanox Fabric Detected
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[600px] w-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeClick={onEdgeClick}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background variant="dots" gap={12} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        
        {/* Connection Legend */}
        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2 mb-3">
            <Info className="h-4 w-4" />
            <span className="font-semibold text-sm">Connection Types</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(connectionStyles).filter(([key]) => key !== 'default').map(([key, style]) => (
              <TooltipProvider key={key}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-help">
                      <div 
                        className="w-8 h-1 rounded"
                        style={{ 
                          backgroundColor: style.stroke,
                          height: `${style.strokeWidth}px`,
                          backgroundImage: style.strokeDasharray ? 
                            `repeating-linear-gradient(90deg, ${style.stroke}, ${style.stroke} 5px, transparent 5px, transparent 10px)` : 
                            undefined
                        }}
                      />
                      <span className="text-xs">{style.label}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{style.description}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
          
          {/* Additional Info */}
          <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
            <div className="flex items-center gap-4 flex-wrap">
              <span>• Bandwidth shown on connections</span>
              <span>• Animated lines indicate high-speed links</span>
              <span>• Grouped by host ({Object.keys(data.gpus.reduce((acc, gpu) => {
                acc[gpu.host] = true;
                return acc;
              }, {} as Record<string, boolean>)).length} hosts)</span>
              <span>• Total GPUs: {data.gpus.length}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}