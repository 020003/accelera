import { useState, useEffect } from 'react';

interface GPUConnection {
  target: string;
  type: string; // Can be NVLink, PCIe-SYS, PCIe-NODE, PCIe-PHB, PCIe-PIX, etc.
  bandwidth: number;
  description?: string;
  raw_type?: string;
}

interface NICConnection {
  nic_id: string;
  nic_name: string;
  connection_type: string;
  description: string;
}

interface GPU {
  id: string;
  name: string;
  host: string;
  utilization: number;
  memory: { used: number; total: number };
  temperature: number;
  power: { draw: number; limit: number };
  connections: GPUConnection[];
  nic_connections?: NICConnection[];
  uuid?: string;
  pci_info?: any;
}

interface HostInfo {
  hostname: string;
  network_interfaces: any[];
  gpu_count: number;
  mellanox_nics?: Array<{
    id: string;
    name: string;
    type: string;
  }>;
}

interface TopologyData {
  gpus: GPU[];
  hosts?: Map<string, HostInfo>;
  mellanoxFabric?: boolean;
}

export function useTopology() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get backend hosts from environment or use defaults
  const backendHosts = import.meta.env.VITE_BACKEND_HOSTS?.split(',').filter(Boolean) || [
    window.location.protocol + '//' + window.location.hostname + ':5000'
  ];

  const fetchTopology = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch topology from all hosts in parallel
      const promises = backendHosts.map(async (host) => {
        try {
          const response = await fetch(`${host}/api/topology`);
          if (!response.ok) throw new Error(`Failed to fetch from ${host}`);
          const data = await response.json();
          return data;
        } catch (err) {
          console.error(`Error fetching from ${host}:`, err);
          return null;
        }
      });

      const results = await Promise.all(promises);
      
      // Combine GPUs from all hosts
      const allGPUs: GPU[] = [];
      const hostInfoMap = new Map<string, HostInfo>();
      let globalGPUIndex = 0;
      let hasMellanoxFabric = false;
      
      results.forEach((result, hostIndex) => {
        if (result && result.gpus) {
          // Extract host identifier from the backend URL
          const hostUrl = backendHosts[hostIndex];
          const hostIP = hostUrl.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1] || result.host_info?.hostname || 'unknown';
          
          // Store host info
          if (result.host_info) {
            hostInfoMap.set(hostIP, result.host_info);
            if (result.host_info.mellanox_nics && result.host_info.mellanox_nics.length > 0) {
              hasMellanoxFabric = true;
            }
          }
          
          // Create a mapping of local IDs to global IDs for this host
          const localToGlobalMap: Record<string, string> = {};
          result.gpus.forEach((gpu: GPU, localIndex: number) => {
            localToGlobalMap[`gpu-${localIndex}`] = `gpu-${globalGPUIndex + localIndex}`;
          });
          
          result.gpus.forEach((gpu: GPU, localIndex: number) => {
            // Update GPU ID to be globally unique
            const globalId = `gpu-${globalGPUIndex}`;
            
            // Update connections to use global IDs
            const updatedConnections = gpu.connections.map((conn: GPUConnection) => {
              const newTarget = localToGlobalMap[conn.target] || conn.target;
              return {
                ...conn,
                target: newTarget
              };
            });
            
            allGPUs.push({
              ...gpu,
              id: globalId,
              host: hostIP,
              connections: updatedConnections,
              nic_connections: gpu.nic_connections || []
            });
            
            globalGPUIndex++;
          });
        }
      });

      // Add inter-host connections for GPUs with Mellanox fabric
      if (hasMellanoxFabric) {
        const uniqueHosts = [...new Set(allGPUs.map(g => g.host))];
        
        if (uniqueHosts.length > 1) {
          // Add Mellanox fabric connections between GPUs on different hosts
          // GPUs with Mellanox NICs can communicate across hosts
          allGPUs.forEach((gpu) => {
            // Check if this GPU has Mellanox NIC connections
            const hasMellanoxNIC = gpu.nic_connections && 
              gpu.nic_connections.some(nic => nic.nic_name.toLowerCase().includes('mlx'));
            
            if (hasMellanoxNIC) {
              allGPUs.forEach((otherGpu) => {
                const otherHasMellanoxNIC = otherGpu.nic_connections && 
                  otherGpu.nic_connections.some(nic => nic.nic_name.toLowerCase().includes('mlx'));
                
                if (gpu.id !== otherGpu.id && 
                    gpu.host !== otherGpu.host && 
                    otherHasMellanoxNIC) {
                  // Check if connection already exists
                  const hasConnection = gpu.connections.some(
                    conn => conn.target === otherGpu.id
                  );
                  
                  if (!hasConnection) {
                    // Add Mellanox fabric connection
                    gpu.connections.push({
                      target: otherGpu.id,
                      type: 'Mellanox',
                      bandwidth: 100, // InfiniBand can be 100-200 Gbps
                      description: 'Mellanox InfiniBand/RoCE fabric connection'
                    });
                  }
                }
              });
            }
          });
        }
      }

      setData({ 
        gpus: allGPUs,
        hosts: hostInfoMap,
        mellanoxFabric: hasMellanoxFabric
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch topology');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopology();
    
    // Don't auto-refresh topology - it doesn't change often and causes UI jumps
    // Users can manually refresh if needed
    // const interval = setInterval(fetchTopology, 30000);
    // return () => clearInterval(interval);
  }, []);

  return { data, loading, error, refetch: fetchTopology };
}