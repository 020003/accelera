export interface GpuEvent {
  type: string;
  gpu_id: number;
  gpu_name?: string;
  host: string;
  count?: number;
  xid?: number;
  severity: "critical" | "warning" | "info";
  message: string;
  timestamp: string;
}

export interface GpuEventsResponse {
  events: GpuEvent[];
  total: number;
  timestamp: string;
}
