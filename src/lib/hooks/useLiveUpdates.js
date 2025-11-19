import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getStoredSession } from "../api.js";
import { API_ROUTES } from "../api-routes.js";

function resolveBaseUrl() {
  const raw = (import.meta?.env?.VITE_API_BASE_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return "http://localhost:3001";
}

function buildWebSocketUrl() {
  const base = resolveBaseUrl();
  const wsPath = API_ROUTES.websocket.startsWith("/")
    ? API_ROUTES.websocket
    : `/${API_ROUTES.websocket}`;

  try {
    const httpUrl = base.startsWith("http") || base.startsWith("ws") ? base : `http://${base}`;
    const parsed = new URL(httpUrl);
    const protocol = parsed.protocol === "https:" || parsed.protocol === "wss:" ? "wss:" : "ws:";
    const path = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
    return `${protocol}//${parsed.host}${path}`;
  } catch (_error) {
    return base.startsWith("wss://") || base.startsWith("ws://")
      ? `${base.replace(/\/$/, "")}${wsPath}`
      : `ws://${base.replace(/\/$/, "")}${wsPath}`;
  }
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
  const reconnectAttemptsRef = useRef(0);
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
    if (
      currentSocket &&
      (currentSocket.readyState === WebSocket.OPEN ||
        currentSocket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    clearReconnectTimer();

    const token = getStoredSession()?.token || null;
    if (!token) {
      setConnecting(false);
      setConnected(false);
      setError(new Error("Sessão não autenticada. Faça login novamente."));
      return;
    }

    const baseUrl = buildWebSocketUrl();
    const url = appendToken(baseUrl, token);

    setConnecting(true);
    setError(null);

    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      setConnecting(false);
      setError(null);
      reconnectAttemptsRef.current = 0;
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
      if (
        payload &&
        typeof payload === "object" &&
        payload.type === "connection" &&
        payload.status === "ready"
      ) {
        setError(null);
        return;
      }
      setLastMessage(payload);
      if (onMessageRef.current) {
        onMessageRef.current(payload);
      }
    };

    socket.onerror = (event) => {
      const message = event?.message || "Não foi possível atualizar os dados de telemetria.";
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
        const nextDelay = Math.min(
          reconnectDelayMs * 2 ** reconnectAttemptsRef.current,
          30_000,
        );
        reconnectAttemptsRef.current += 1;
        reconnectTimerRef.current = globalThis.setTimeout(() => {
          reconnectTimerRef.current = null;
          connect();
        }, nextDelay);
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
