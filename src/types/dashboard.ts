import type { GpuInfo } from "./gpu";

export interface Host {
  url: string;
  name: string;
  isConnected: boolean;
}

export interface HostData {
  url: string;
  name: string;
  isConnected: boolean;
  gpus: GpuInfo[];
  timestamp?: string;
  error?: string;
  ollama?: {
    isAvailable: boolean;
    models: any[];
    performanceMetrics: any;
    recentRequests: any[];
  };
  sglang?: {
    isAvailable: boolean;
    models: any[];
    sglangUrl?: string;
    serverInfo?: any;
  };
  vllm?: {
    isAvailable: boolean;
    models: any[];
    vllmUrl?: string;
    version?: string;
  };
}
