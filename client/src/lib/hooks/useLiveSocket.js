import { useEffect, useMemo, useRef, useState } from "react";
import api, { getApiBaseUrl, getStoredSession } from "../api.js";
import { API_ROUTES } from "../api-routes.js";
import { useTranslation } from "../i18n.js";

function buildWebSocketUrl() {
  const base = getApiBaseUrl();
  try {
    const url = new URL(base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `/${API_ROUTES.websocket.replace(/^\/+/, "")}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    const normalised = (base || "").replace(/\/$/, "");
    const protocol = normalised.startsWith("https://") ? "wss" : "ws";
    const host = normalised.replace(/^https?:\/\//, "");
    const path = API_ROUTES.websocket.startsWith("/") ? API_ROUTES.websocket : `/${API_ROUTES.websocket}`;
    return `${protocol}://${host}${path}`;
  }
}

function appendToken(url, token) {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
const DEFAULT_MAX_ATTEMPTS = 5;

class LiveSocketManager {
  constructor() {
    this.socket = null;
    this.reconnectTimer = null;
    this.pollingTimer = null;
    this.manualClose = false;
    this.messageListeners = new Set();
    this.stateListeners = new Set();
    this.reconnectAttempts = 0;
    this.enabled = true;
    this.backoff = DEFAULT_BACKOFF;
    this.maxAttempts = DEFAULT_MAX_ATTEMPTS;
    this.pollingIntervalMs = 10_000;
    this.state = {
      connected: false,
      connecting: false,
      error: null,
      fallback: false,
      attempts: 0,
    };
  }

  configure({ backoff, maxAttempts, pollingIntervalMs }) {
    if (Array.isArray(backoff) && backoff.length > 0) {
      this.backoff = backoff;
    }
    if (Number.isFinite(maxAttempts) && maxAttempts > 0) {
      this.maxAttempts = maxAttempts;
    }
    if (Number.isFinite(pollingIntervalMs) && pollingIntervalMs > 0) {
      this.pollingIntervalMs = pollingIntervalMs;
    }
  }

  getState() {
    return this.state;
  }

  setState(partial) {
    this.state = { ...this.state, ...partial };
    this.stateListeners.forEach((listener) => {
      listener(this.state);
    });
  }

  subscribeState(listener) {
    if (typeof listener !== "function") return () => {};
    this.stateListeners.add(listener);
    listener(this.state);
    return () => {
      this.stateListeners.delete(listener);
      this.maybeShutdown();
    };
  }

  subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
      this.maybeShutdown();
    };
  }

  emitMessage(payload) {
    this.messageListeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.warn("[LiveSocket] Listener error", error);
      }
    });
  }

  ensureConnection() {
    this.enabled = true;
    if (this.state.connected || this.state.connecting || this.state.fallback) {
      return;
    }
    this.connect();
  }

  connect() {
    if (!this.enabled || typeof window === "undefined") return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = getStoredSession()?.token || null;
    if (!token) {
      this.setState({ connecting: false, connected: false, error: new Error("Sessão não autenticada"), fallback: false });
      return;
    }

    this.clearReconnect();
    this.stopPolling();

    const url = appendToken(buildWebSocketUrl(), token);
    console.info("[LiveSocket] Opening WebSocket", { url });

    try {
      this.socket = new WebSocket(url);
    } catch (error) {
      this.handleConnectionError(error);
      return;
    }

    this.setState({ connecting: true, error: null, fallback: false });

    this.socket.onopen = () => {
      console.info("[LiveSocket] Connected");
      this.reconnectAttempts = 0;
      this.setState({ connected: true, connecting: false, error: null, fallback: false, attempts: 0 });
    };

    this.socket.onmessage = (event) => {
      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch (_parseError) {
          // keep original payload
        }
      }
      if (
        payload &&
        typeof payload === "object" &&
        payload.type === "connection" &&
        payload.status === "ready"
      ) {
        this.setState({ error: null });
        return;
      }
      this.emitMessage(payload);
    };

    this.socket.onerror = (event) => {
      const message = event?.message || "Não foi possível atualizar os dados de telemetria.";
      this.setState({ error: new Error(message) });
    };

    this.socket.onclose = () => {
      console.info("[LiveSocket] Closed");
      this.socket = null;
      const wasManual = this.manualClose;
      this.manualClose = false;
      this.setState({ connected: false, connecting: false });
      if (wasManual || !this.enabled) {
        return;
      }
      this.scheduleReconnect();
    };
  }

  handleConnectionError(error) {
    console.warn("[LiveSocket] Connection error", error);
    this.setState({ connected: false, connecting: false, error: error instanceof Error ? error : new Error("Erro de conexão") });
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxAttempts) {
      this.activateFallback();
      return;
    }

    if (this.reconnectTimer) return;
    const delay = this.backoff[Math.min(this.reconnectAttempts, this.backoff.length - 1)] ?? this.backoff[this.backoff.length - 1];
    this.reconnectAttempts += 1;
    this.setState({ attempts: this.reconnectAttempts, connecting: true, connected: false });
    this.reconnectTimer = globalThis.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  clearReconnect() {
    if (this.reconnectTimer) {
      globalThis.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  activateFallback() {
    if (this.state.fallback) return;
    console.warn("[LiveSocket] Activating fallback polling");
    this.setState({ fallback: true, connecting: false, connected: false });
    this.startPolling();
  }

  startPolling() {
    this.stopPolling();
    const tick = async () => {
      try {
        const [positions, events] = await Promise.all([
          api.get(API_ROUTES.lastPositions).then((response) => response?.data).catch(() => null),
          api.get(API_ROUTES.events).then((response) => response?.data).catch(() => null),
        ]);
        const payload = {};
        if (positions) payload.positions = positions;
        if (events) payload.events = events;
        this.emitMessage(payload);
      } catch (error) {
        console.warn("[LiveSocket] Fallback polling failed", error);
      }
    };

    tick();
    this.pollingTimer = globalThis.setInterval(tick, this.pollingIntervalMs);
  }

  stopPolling() {
    if (this.pollingTimer) {
      globalThis.clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  disconnect() {
    this.enabled = false;
    this.manualClose = true;
    this.clearReconnect();
    this.stopPolling();
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_error) {
        // ignore
      }
    }
    this.socket = null;
    this.setState({ connected: false, connecting: false });
  }

  reconnect() {
    this.manualClose = false;
    this.enabled = true;
    this.clearReconnect();
    this.stopPolling();
    this.reconnectAttempts = 0;
    this.connect();
  }

  maybeShutdown() {
    if (this.messageListeners.size === 0 && this.stateListeners.size === 0) {
      this.disconnect();
    }
  }
}

let manager;
function getManager() {
  if (!manager) {
    manager = new LiveSocketManager();
  }
  return manager;
}

export function useLiveSocket({
  enabled = true,
  onMessage,
  backoffDelays = DEFAULT_BACKOFF,
  maxReconnectAttempts = DEFAULT_MAX_ATTEMPTS,
  pollingIntervalMs = 10_000,
} = {}) {
  const { t } = useTranslation();
  const [state, setState] = useState(() => getManager().getState());
  const managerRef = useRef(getManager());
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    managerRef.current.configure({ backoff: backoffDelays, maxAttempts: maxReconnectAttempts, pollingIntervalMs });
    if (enabled) {
      managerRef.current.ensureConnection();
    } else {
      managerRef.current.disconnect();
    }
  }, [enabled, backoffDelays, maxReconnectAttempts, pollingIntervalMs]);

  useEffect(() => {
    const unsubscribeState = managerRef.current.subscribeState(setState);
    const unsubscribeMessage = onMessageRef.current
      ? managerRef.current.subscribe((payload) => {
          onMessageRef.current?.(payload);
        })
      : () => {};

    managerRef.current.ensureConnection();

    return () => {
      unsubscribeMessage();
      unsubscribeState();
    };
  }, []);

  const errorMessage = state.error?.message || null;

  return useMemo(
    () => ({
      connected: state.connected,
      connecting: state.connecting,
      error: state.error,
      attempts: state.attempts,
      fallback: state.fallback,
      fallbackMessage: state.fallback
        ? t("monitoring.liveFallback", { defaultValue: "Conexão em tempo real instável, dados em modo consulta periódica." })
        : null,
      errorMessage,
      reconnect: () => managerRef.current.reconnect(),
      disconnect: () => managerRef.current.disconnect(),
    }),
    [state.connected, state.connecting, state.error, state.attempts, state.fallback, errorMessage, t],
  );
}

export default useLiveSocket;
