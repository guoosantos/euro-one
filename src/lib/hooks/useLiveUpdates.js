import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoredSession } from "../api.js";

function resolveBaseUrl() {
  const raw = (import.meta?.env?.VITE_API_BASE_URL || "http://localhost:3001").trim();
  if (!raw) return "http://localhost:3001";
  return raw.replace(/\/$/, "");
}

function buildWebSocketUrl() {
  const base = resolveBaseUrl();
  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return `${base}/ws/live`;
  }
  if (base.startsWith("https://")) {
    return `wss://${base.slice("https://".length)}/ws/live`;
  }
  if (base.startsWith("http://")) {
    return `ws://${base.slice("http://".length)}/ws/live`;
  }
  return `ws://${base}/ws/live`;
}

function appendToken(url, token) {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

export function useLiveUpdates({ enabled = true, reconnectDelayMs = 5_000, onMessage } = {}) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [lastMessage, setLastMessage] = useState(null);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const manualCloseRef = useRef(false);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      globalThis.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const currentSocket = socketRef.current;
    if (currentSocket && (currentSocket.readyState === WebSocket.OPEN || currentSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    clearReconnectTimer();

    const baseUrl = buildWebSocketUrl();
    const token = getStoredSession()?.token || null;
    const url = appendToken(baseUrl, token);

    setConnecting(true);
    setError(null);

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setConnecting(false);
      setError(null);
    };

    socket.onmessage = (event) => {
      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch (_parseError) {
          // Mantém payload original quando não for JSON
        }
      }
      setLastMessage(payload);
      if (onMessageRef.current) {
        onMessageRef.current(payload);
      }
    };

    socket.onerror = (event) => {
      const message = event?.message || "Falha na conexão em tempo real";
      setError(new Error(message));
    };

    socket.onclose = () => {
      setConnected(false);
      setConnecting(false);
      socketRef.current = null;
      if (manualCloseRef.current || !enabled) {
        manualCloseRef.current = false;
        return;
      }
      if (!reconnectTimerRef.current) {
        reconnectTimerRef.current = globalThis.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, reconnectDelayMs);
      }
    };
  }, [clearReconnectTimer, enabled, reconnectDelayMs]);

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    clearReconnectTimer();
    const socket = socketRef.current;
    if (socket) {
      try {
        socket.close();
      } catch (_error) {
        // Ignora falhas no fechamento
      }
    }
    socketRef.current = null;
    setConnected(false);
    setConnecting(false);
  }, [clearReconnectTimer]);

  const reconnect = useCallback(() => {
    disconnect();
    connect();
  }, [disconnect, connect]);

  useEffect(() => {
    if (!enabled) {
      disconnect();
      return undefined;
    }
    connect();
    return () => {
      manualCloseRef.current = true;
      disconnect();
    };
  }, [connect, disconnect, enabled]);

  return useMemo(
    () => ({ connected, connecting, error, lastMessage, reconnect, disconnect }),
    [connected, connecting, error, lastMessage, reconnect, disconnect],
  );
}

export default useLiveUpdates;
