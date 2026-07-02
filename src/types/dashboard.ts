import type { GpuInfo } from "./gpu";

export interface Host {
  url: string;
  name: string;
  isConnected: boolean;
}

export interface RuntimeModel {
  id?: string;
  name?: string;
  size?: number;
  [key: string]: unknown;
}

export interface HostData {
  url: string;
  name: string;
  isConnected: boolean;
  gpus: GpuInfo[];
  timestamp?: string;
  error?: string;
  snapshotSource?: string;
  stale?: boolean;
  fetchedAt?: number;
  lastSuccessAt?: number;
  fetchDurationMs?: number;
  cacheAgeSeconds?: number;
  ollama?: {
    isAvailable: boolean;
    models: RuntimeModel[];
    performanceMetrics: unknown;
    recentRequests: unknown[];
  };
  sglang?: {
    isAvailable: boolean;
    models: RuntimeModel[];
    sglangUrl?: string;
    serverInfo?: unknown;
  };
  vllm?: {
    isAvailable: boolean;
    models: RuntimeModel[];
    vllmUrl?: string;
    vllmUrls?: string[];
    version?: string;
    instances?: unknown[];
  };
}
