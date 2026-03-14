import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { resolvePageMeta } from "../../lib/page-meta.js";
import { AIClient } from "./ai-client.js";
import { AI_ASSISTANT_NAME } from "./ai-config.js";
import { OPERATIONAL_AI_OPEN_EVENT } from "./operational-ai-events.js";

const OperationalAIContext = createContext(null);

function sanitizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createScreenContext(location) {
  const meta = resolvePageMeta(location.pathname);
  return {
    screenId: meta?.title || location.pathname || "Tela",
    title: meta?.title || `${AI_ASSISTANT_NAME}`,
    routePath: location.pathname,
  };
}

function createUserMessage(content) {
  return {
    id: `${Date.now()}-user`,
    role: "user",
    content: String(content || "").trim(),
    createdAt: new Date().toISOString(),
  };
}

function createAssistantMessage(response) {
  return {
    id: response?.auditId || `${Date.now()}-assistant`,
    role: "assistant",
    content: response?.response?.text || "Sem resposta da camada de IA.",
    createdAt: new Date().toISOString(),
    toolsUsed: response?.response?.toolsUsed || [],
    provider: response?.provider || null,
    traceId: response?.traceId || null,
    estimatedCost: response?.response?.estimatedCost ?? null,
    contextId: response?.contextId || null,
    context: response?.context || null,
  };
}

export function OperationalAIProvider({ children }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const pageContextRef = useRef({ screen: createScreenContext(location), entity: null, filters: null });

  useEffect(() => {
    pageContextRef.current = {
      ...pageContextRef.current,
      screen: createScreenContext(location),
    };
  }, [location]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleOpenEvent = () => setOpen(true);
    window.addEventListener(OPERATIONAL_AI_OPEN_EVENT, handleOpenEvent);
    return () => window.removeEventListener(OPERATIONAL_AI_OPEN_EVENT, handleOpenEvent);
  }, []);

  useEffect(() => {
    let active = true;
    AIClient.listTools()
      .then((data) => {
        if (!active) return;
        setCatalog(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const registerPageContext = useCallback((partial) => {
    const input = sanitizeObject(partial);
    pageContextRef.current = {
      ...pageContextRef.current,
      ...input,
      screen: input.screen ? { ...pageContextRef.current.screen, ...input.screen } : pageContextRef.current.screen,
      entity: Object.prototype.hasOwnProperty.call(input, "entity")
        ? (input.entity ? { ...input.entity } : null)
        : pageContextRef.current.entity,
      filters: Object.prototype.hasOwnProperty.call(input, "filters")
        ? (input.filters ? { ...input.filters } : null)
        : pageContextRef.current.filters,
    };
  }, []);

  const clearPageEntity = useCallback(() => {
    pageContextRef.current = {
      ...pageContextRef.current,
      entity: null,
      filters: null,
    };
  }, []);

  const buildPayload = useCallback((message, extras = {}) => ({
    message,
    history: history.slice(-8).map((item) => ({ role: item.role, content: item.content })),
    context: {
      screen: pageContextRef.current.screen,
      entity: pageContextRef.current.entity,
      filters: pageContextRef.current.filters,
    },
    ...extras,
  }), [history]);

  const sendMessage = useCallback(async (message, extras = {}) => {
    const text = String(message || "").trim();
    if (!text) return null;
    setError(null);
    setPending(true);
    const userMessage = createUserMessage(text);
    setHistory((current) => [...current, userMessage]);
    try {
      const response = await AIClient.chat(buildPayload(text, extras));
      const assistantMessage = createAssistantMessage(response);
      setHistory((current) => [...current, assistantMessage]);
      setOpen(true);
      return response;
    } catch (requestError) {
      setError(requestError?.message || "Falha ao consultar a camada de IA.");
      throw requestError;
    } finally {
      setPending(false);
    }
  }, [buildPayload]);

  const runQuickAction = useCallback(async (action) => {
    setError(null);
    setPending(true);
    try {
      let response;
      if (action === "investigate") {
        response = await AIClient.investigateVehicle(buildPayload("Investigar o contexto atual do veiculo.", {}));
      } else if (action === "summarize") {
        response = await AIClient.summarizeEvent(buildPayload("Resuma a ocorrencia ou contexto atual.", {}));
      } else if (action === "prioritize") {
        response = await AIClient.prioritizeAlert(buildPayload("Qual prioridade operacional voce recomenda para este caso?", {}));
      } else {
        response = await AIClient.chat(buildPayload("Resuma o contexto operacional atual.", {}));
      }
      const assistantMessage = createAssistantMessage(response);
      setHistory((current) => [...current, assistantMessage]);
      setOpen(true);
      return response;
    } catch (requestError) {
      setError(requestError?.message || "Falha ao executar a acao do copiloto.");
      throw requestError;
    } finally {
      setPending(false);
    }
  }, [buildPayload]);

  const value = useMemo(() => ({
    open,
    setOpen,
    pending,
    history,
    error,
    catalog,
    screenContext: pageContextRef.current.screen,
    entityContext: pageContextRef.current.entity,
    registerPageContext,
    clearPageEntity,
    sendMessage,
    runQuickAction,
    clearHistory: () => setHistory([]),
  }), [catalog, clearPageEntity, error, history, open, pending, registerPageContext, runQuickAction, sendMessage]);

  return <OperationalAIContext.Provider value={value}>{children}</OperationalAIContext.Provider>;
}

export function useOperationalAI() {
  const value = useContext(OperationalAIContext);
  if (!value) {
    throw new Error("useOperationalAI deve ser usado dentro de OperationalAIProvider");
  }
  return value;
}

export default OperationalAIProvider;
