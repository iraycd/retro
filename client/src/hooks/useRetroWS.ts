import { useEffect, useRef, useState, useCallback } from "react";
import type { ClientMsg, ServerMsg } from "../types";

export function useRetroWS(
  onMessage: (msg: ServerMsg) => void,
  noReconnect?: React.RefObject<boolean>
): [(msg: ClientMsg) => void, boolean] {
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(500);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback(() => {
    if (noReconnect?.current) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      retryRef.current = 500;
    };

    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data) as ServerMsg); } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      if (noReconnect?.current) return;
      const delay = retryRef.current;
      retryRef.current = Math.min(retryRef.current * 1.5, 5000);
      retryTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [onMessage, noReconnect]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((obj: ClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(obj));
    }
  }, []);

  return [send, connected];
}
