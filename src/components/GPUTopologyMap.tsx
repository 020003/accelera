import React, { useCallback, useEffect, useState } from 'react';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Cpu, HardDrive, Zap, Activity } from 'lucide-react';

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
      type: 'NVLink' | 'PCIe' | 'SXM';
      bandwidth: number;
    }>;
  }>;
}

interface GPUNodeData {
  label: string;
  gpu: GPUTopologyData['gpus'][0];
}

const nodeTypes = {
  gpu: ({ data }: { data: GPUNodeData }) => {
    const memoryPercent = (data.gpu.memory.used / data.gpu.memory.total) * 100;
    const powerPercent = (data.gpu.power.draw / data.gpu.power.limit) * 100;
    
    return (
      <div className="bg-background border-2 border-primary rounded-lg p-3 min-w-[250px]">
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
            <span>{data.gpu.host}</span>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Memory:</span>
            <div className="flex items-center gap-1">
              <HardDrive className="h-3 w-3" />
              <span>{memoryPercent.toFixed(1)}%</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Temp:</span>
            <div className="flex items-center gap-1">
              <Activity className="h-3 w-3" />
              <span>{data.gpu.temperature}°C</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Power:</span>
            <div className="flex items-center gap-1">
              <Zap className="h-3 w-3" />
              <span>{powerPercent.toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div className="mt-2 pt-2 border-t">
          <div className="w-full bg-secondary rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${data.gpu.utilization}%` }}
            />
          </div>
        </div>
      </div>
    );
  },
};

const edgeTypes = {
  nvlink: {
    strokeWidth: 3,
    stroke: '#10b981',
    animated: true,
    label: 'NVLink',
  },
  pcie: {
    strokeWidth: 2,
    stroke: '#6366f1',
    animated: false,
    label: 'PCIe',
  },
  sxm: {
    strokeWidth: 4,
    stroke: '#f59e0b',
    animated: true,
    label: 'SXM',
  },
};

export function GPUTopologyMap({ data }: { data?: GPUTopologyData }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  useEffect(() => {
    if (!data) return;
    
    // Create nodes from GPU data
    const newNodes: Node<GPUNodeData>[] = data.gpus.map((gpu, index) => {
      const angle = (2 * Math.PI * index) / data.gpus.length;
      const radius = 300;
      const x = radius * Math.cos(angle) + 400;
      const y = radius * Math.sin(angle) + 300;
      
      return {
        id: gpu.id,
        type: 'gpu',
        position: { x, y },
        data: {
          label: gpu.name,
          gpu,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    });
    
    // Create edges from connections
    const newEdges: Edge[] = [];
    data.gpus.forEach((gpu) => {
      gpu.connections?.forEach((conn) => {
        const edgeType = conn.type.toLowerCase() as keyof typeof edgeTypes;
        const style = edgeTypes[edgeType] || edgeTypes.pcie;
        
        newEdges.push({
          id: `${gpu.id}-${conn.target}`,
          source: gpu.id,
          target: conn.target,
          type: 'smoothstep',
          animated: style.animated,
          style: {
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
          },
          label: `${conn.type}\n${conn.bandwidth} GB/s`,
          labelStyle: { fontSize: 10, fontWeight: 600 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: style.stroke,
          },
        });
      });
    });
    
    setNodes(newNodes);
    setEdges(newEdges);
  }, [data, setNodes, setEdges]);
  
  const onConnect = useCallback(
    (params: Edge | Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );
  
  // Demo data if no real data provided
  useEffect(() => {
    if (!data) {
      const demoData: GPUTopologyData = {
        gpus: [
          {
            id: 'gpu-0',
            name: 'RTX 4090 #0',
            host: 'server-1',
            utilization: 85,
            memory: { used: 20000, total: 24576 },
            temperature: 72,
            power: { draw: 380, limit: 450 },
            connections: [
              { target: 'gpu-1', type: 'NVLink', bandwidth: 600 },
              { target: 'gpu-2', type: 'PCIe', bandwidth: 32 },
            ],
          },
          {
            id: 'gpu-1',
            name: 'RTX 4090 #1',
            host: 'server-1',
            utilization: 62,
            memory: { used: 15000, total: 24576 },
            temperature: 68,
            power: { draw: 320, limit: 450 },
            connections: [
              { target: 'gpu-0', type: 'NVLink', bandwidth: 600 },
              { target: 'gpu-3', type: 'PCIe', bandwidth: 32 },
            ],
          },
          {
            id: 'gpu-2',
            name: 'A100 #0',
            host: 'server-2',
            utilization: 95,
            memory: { used: 38000, total: 40960 },
            temperature: 78,
            power: { draw: 380, limit: 400 },
            connections: [
              { target: 'gpu-3', type: 'SXM', bandwidth: 900 },
              { target: 'gpu-0', type: 'PCIe', bandwidth: 32 },
            ],
          },
          {
            id: 'gpu-3',
            name: 'A100 #1',
            host: 'server-2',
            utilization: 91,
            memory: { used: 36000, total: 40960 },
            temperature: 76,
            power: { draw: 370, limit: 400 },
            connections: [
              { target: 'gpu-2', type: 'SXM', bandwidth: 900 },
              { target: 'gpu-1', type: 'PCIe', bandwidth: 32 },
            ],
          },
        ],
      };
      
      // Trigger update with demo data
      const event = new CustomEvent('topologyData', { detail: demoData });
      window.dispatchEvent(event);
    }
  }, [data]);
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          GPU Topology Map
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
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Background variant="dots" gap={12} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        
        <div className="mt-4 flex gap-4 justify-center">
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-green-500" />
            <span className="text-sm text-muted-foreground">NVLink (High Speed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-amber-500" />
            <span className="text-sm text-muted-foreground">SXM (Ultra High Speed)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-1 bg-indigo-500" />
            <span className="text-sm text-muted-foreground">PCIe (Standard)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}