import { URL } from "url";
import WebSocket from "ws";

import { config } from "../config.js";
import { getAdminSessionCookie, initializeTraccarAdminSession } from "./traccar.js";

const RECONNECTABLE_CODES = new Set([1000, 1001, 1006]);
const RECONNECT_BASE_DELAY = 2_000;
const RECONNECT_MAX_DELAY = 60_000;

function buildTraccarSocketUrl() {
  try {
    const parsed = new URL(config.traccar.baseUrl || "http://localhost:8082");
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/api/socket`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    const base = (config.traccar.baseUrl || "http://localhost:8082").replace(/\/$/, "");
    if (base.startsWith("https://")) {
      return `wss://${base.slice("https://".length)}/api/socket`;
    }
    if (base.startsWith("http://")) {
      return `ws://${base.slice("http://".length)}/api/socket`;
    }
    return `${base}/api/socket`;
  }
}

function buildTraccarSocketHeaders() {
  const session = getAdminSessionCookie();
  if (!session) {
    throw new Error("Sessão administrativa do Traccar indisponível.");
  }

  const headers = { Cookie: `JSESSIONID=${session}` };
  try {
    const origin = new URL(config.traccar.baseUrl || "http://localhost:8082");
    headers.Origin = `${origin.protocol}//${origin.host}`;
  } catch (_error) {
    headers.Origin = config.traccar.baseUrl;
  }
  return headers;
}

export class TraccarWsClient {
  constructor({ onMessage } = {}) {
    this.socket = null;
    this.onMessage = onMessage;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_MAX_DELAY, RECONNECT_BASE_DELAY * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    console.info(
      "[Traccar WS] Reconexão agendada em %dms (tentativa #%d)...",
      delay,
      this.reconnectAttempts,
    );
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      console.info("[Traccar WS] Tentando restabelecer sessão administrativa antes de reconectar...");
      await initializeTraccarAdminSession().catch(() => undefined);
      console.info("[Traccar WS] Reabrindo conexão com o Traccar...");
      this.connect();
    }, delay);
  }

  async ensureSession() {
    if (getAdminSessionCookie()) return true;

    console.info("[Traccar WS] Criando sessão administrativa antes de abrir o WebSocket...");
    await initializeTraccarAdminSession().catch((error) => {
      console.warn("[Traccar WS] Falha ao preparar sessão administrativa", error?.message || error);
    });

    if (!getAdminSessionCookie()) {
      console.warn("[Traccar WS] Sessão administrativa ausente; nova tentativa em breve.");
      this.scheduleReconnect();
      return false;
    }

    return true;
  }

  async ensureConnection() {
    if (this.socket || this.isConnecting) return;
    const hasSession = await this.ensureSession();
    if (!hasSession) return;
    this.connect();
  }

  connect() {
    if (this.isConnecting) return;
    this.isConnecting = true;
    try {
      const url = buildTraccarSocketUrl();
      const headers = buildTraccarSocketHeaders();
      console.info(`[Traccar WS] Conectando em ${url} usando cookie de sessão...`);
      const socket = new WebSocket(url, ["traccar"], { headers });

      if (!socket || typeof socket.on !== "function") {
        this.isConnecting = false;
        console.error("[Traccar WS] Socket inválido ao tentar registrar handlers", {
          type: typeof socket,
          value: socket,
        });
        this.scheduleReconnect();
        return;
      }

      this.socket = socket;

      socket.on("open", () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        console.info("[Traccar WS] Conexão aberta.");
      });

      socket.on("unexpected-response", (_req, res) => {
        console.error("[Traccar WS] unexpected-response", res?.statusCode, res?.headers);
      });

      socket.on("message", (data) => {
        if (typeof this.onMessage === "function") {
          const payload = typeof data === "string" ? data : data?.toString?.() ?? data;
          this.onMessage(payload);
        }
      });

      socket.on("error", (err) => {
        console.error("[Traccar WS] Error", err);
      });

      socket.on("close", (code, reason) => {
        const reasonText = reason?.toString?.("utf8") || reason || "";
        console.warn("[Traccar WS] Conexão fechada", { code, reason: reasonText });
        this.socket = null;
        this.isConnecting = false;
        if (RECONNECTABLE_CODES.has(code)) {
          this.scheduleReconnect();
        }
      });
    } catch (error) {
      this.isConnecting = false;
      console.error("[Traccar WS] Falha ao abrir WebSocket", error?.message || error);
      this.scheduleReconnect();
    }
  }

  stop() {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_error) {
        // ignore
      }
      this.socket = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.isConnecting = false;
  }
}

export default TraccarWsClient;
