export interface AlertRule {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  comparison: string;
  gpu_filter: string;
  host_filter: string;
  enabled: boolean;
  cooldown_seconds: number;
  notify_webhook: boolean;
  notify_email: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertEvent {
  id: number;
  rule_id: string;
  rule_name: string;
  metric: string;
  value: number;
  threshold: number;
  gpu_id?: string;
  host?: string;
  message: string;
  severity: "critical" | "warning" | "info";
  acknowledged: boolean;
  created_at: number;
}

export type AlertMetric =
  | "utilization"
  | "temperature"
  | "power_draw"
  | "memory_percent"
  | "memory_used"
  | "fan"
  | "tps"
  | "total_tokens"
  | "token_request_count"
  | "avg_latency_sec";

export type AlertComparison = ">" | ">=" | "<" | "<=" | "==";
