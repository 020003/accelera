import { useEffect, useRef, useState } from "react";
import type { AlertEvent } from "@/types/alerts";

interface UseAlertStreamOptions {
  url?: string;
  enabled?: boolean;
  onAlert?: (alert: AlertEvent) => void;
}

/**
 * Hook that connects to the SSE `/api/stream/alerts` endpoint and
 * calls `onAlert` every time a new alert fires on the server.
 */
export function useAlertStream({ url, enabled = true, onAlert }: UseAlertStreamOptions = {}) {
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  useEffect(() => {
    if (!enabled) return;

    const base = url || "";
    const es = new EventSource(`${base}/api/stream/alerts`);
    esRef.current = es;

    es.addEventListener("status", () => setConnected(true));

    es.addEventListener("alert", (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as AlertEvent;
        onAlertRef.current?.(parsed);
      } catch {
        // ignore
      }
    });

    es.onerror = () => setConnected(false);

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [url, enabled]);

  return { connected };
}
