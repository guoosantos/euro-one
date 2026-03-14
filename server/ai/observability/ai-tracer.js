import { randomUUID } from "crypto";

function nowIso() {
  return new Date().toISOString();
}

function cloneError(error) {
  if (!error) return null;
  return {
    message: error?.message || String(error),
    code: error?.code || null,
    status: error?.status || error?.statusCode || null,
  };
}

export function createAiTrace({ name = "ai.request", correlationId = null, attributes = {} } = {}) {
  const traceId = randomUUID();
  const startedAt = Date.now();
  const spans = [];

  function startSpan(spanName, spanAttributes = {}) {
    const span = {
      id: randomUUID(),
      name: spanName,
      status: "in_progress",
      startedAt: nowIso(),
      startedAtMs: Date.now(),
      endedAt: null,
      durationMs: null,
      attributes: { ...spanAttributes },
      error: null,
    };
    spans.push(span);
    return {
      finish(status = "ok", error = null, extraAttributes = {}) {
        span.status = status;
        span.endedAt = nowIso();
        span.durationMs = Date.now() - span.startedAtMs;
        span.attributes = { ...span.attributes, ...extraAttributes };
        span.error = cloneError(error);
      },
    };
  }

  async function runObserved(spanName, fn, spanAttributes = {}) {
    const span = startSpan(spanName, spanAttributes);
    try {
      const result = await fn();
      span.finish("ok");
      return result;
    } catch (error) {
      span.finish("error", error);
      throw error;
    }
  }

  function finish(status = "ok", error = null, extraAttributes = {}) {
    return {
      traceId,
      correlationId,
      name,
      status,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: nowIso(),
      durationMs: Date.now() - startedAt,
      attributes: { ...attributes, ...extraAttributes },
      error: cloneError(error),
      spans: spans.map((span) => ({
        id: span.id,
        name: span.name,
        status: span.status,
        startedAt: span.startedAt,
        endedAt: span.endedAt,
        durationMs: span.durationMs,
        attributes: { ...span.attributes },
        error: span.error ? { ...span.error } : null,
      })),
    };
  }

  return {
    traceId,
    correlationId,
    startSpan,
    runObserved,
    finish,
  };
}

