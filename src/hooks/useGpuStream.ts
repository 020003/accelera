import { useEffect, useRef, useState, useCallback } from "react";
import type { NvidiaSmiResponse } from "@/types/gpu";

interface UseGpuStreamOptions {
  /** Base URL of the backend, e.g. "http://10.2.63.234:5000" */
  url?: string;
  /** Whether to enable the stream */
  enabled?: boolean;
}

/**
 * Hook that connects to the SSE `/api/stream/gpu` endpoint and
 * yields the latest GPU snapshot every time the server pushes one.
 */
export function useGpuStream({ url, enabled = true }: UseGpuStreamOptions = {}) {
  const [data, setData] = useState<NvidiaSmiResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!enabled) return;

    const base = url || "";
    const es = new EventSource(`${base}/api/stream/gpu`);
    esRef.current = es;

    es.addEventListener("status", () => {
      setConnected(true);
      setError(null);
    });

    es.addEventListener("gpu", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as NvidiaSmiResponse;
        setData(parsed);
      } catch {
        // ignore malformed events
      }
    });

    es.addEventListener("error", () => {
      setConnected(false);
    });

    es.onerror = () => {
      setConnected(false);
      setError("SSE connection lost – reconnecting…");
      // EventSource auto-reconnects; we just track state.
    };
  }, [url, enabled]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [connect]);

  return { data, connected, error };
}
