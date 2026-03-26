import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AlertRule, AlertEvent } from "@/types/alerts";

const API_BASE = "";

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export function useAlertRules() {
  return useQuery<AlertRule[]>({
    queryKey: ["alert-rules"],
    queryFn: () => fetchJson(`${API_BASE}/api/alerts/rules`),
    refetchInterval: 30_000,
  });
}

export function useAlertEvents(limit = 200) {
  return useQuery<AlertEvent[]>({
    queryKey: ["alert-events", limit],
    queryFn: () => fetchJson(`${API_BASE}/api/alerts/events?limit=${limit}`),
    refetchInterval: 10_000,
  });
}

export function useCreateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (rule: Omit<AlertRule, "id" | "created_at" | "updated_at">) =>
      fetchJson<AlertRule>(`${API_BASE}/api/alerts/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });
}

export function useUpdateAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<AlertRule> & { id: string }) =>
      fetchJson<AlertRule>(`${API_BASE}/api/alerts/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });
}

export function useDeleteAlertRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson(`${API_BASE}/api/alerts/rules/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-rules"] }),
  });
}

export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: number) =>
      fetchJson(`${API_BASE}/api/alerts/events/${eventId}/acknowledge`, {
        method: "POST",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alert-events"] }),
  });
}
