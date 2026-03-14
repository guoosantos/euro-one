import { buildSystemPrompt } from "../prompts/system-prompts.js";
import { createAiTrace } from "../observability/ai-tracer.js";
import { buildContextSnapshot } from "../context/context-builder.js";
import { createToolRuntime } from "../tools/tool-runtime.js";
import { createToolExecutor } from "../tools/tool-executor.js";
import { estimateAiCost, recordAiAudit } from "../audit/ai-audit-handler.js";
import { buildLearningContext } from "../learning/learning-store.js";

function summarizeResponseText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 280);
}

export class AIOrchestrator {
  constructor({ providerFactory, config } = {}) {
    this.providerFactory = providerFactory;
    this.config = config;
  }

  async handleRequest(req, payload = {}) {
    const correlationId = req.get?.("x-correlation-id") || req.get?.("x-request-id") || null;
    const contextSnapshot = buildContextSnapshot(req, payload);
    contextSnapshot.learning = buildLearningContext({
      routePath: contextSnapshot.screen?.routePath,
      entityType: contextSnapshot.entity?.entityType,
      limit: 8,
    });
    const trace = createAiTrace({
      name: `ai.${contextSnapshot.flowType}`,
      correlationId,
      attributes: {
        flowType: contextSnapshot.flowType,
        contextId: contextSnapshot.contextId,
      },
    });
    const toolRuntime = createToolRuntime({ req, contextSnapshot });
    const toolExecutor = createToolExecutor({ runtime: toolRuntime, trace });
    const provider = this.providerFactory.resolvePrimaryProvider();
    const fallbackProvider = this.providerFactory.resolveFallbackProvider();
    const systemPrompt = buildSystemPrompt({ flowType: contextSnapshot.flowType, context: contextSnapshot });
    const startedAt = Date.now();

    let providerResult = null;
    let activeProvider = provider;
    let error = null;

    try {
      providerResult = await activeProvider.generate({
        systemPrompt,
        message: contextSnapshot.message,
        history: contextSnapshot.history,
        context: contextSnapshot,
        toolExecutor,
        trace,
      });
    } catch (providerError) {
      error = providerError;
      if (activeProvider !== fallbackProvider) {
        activeProvider = fallbackProvider;
        providerResult = await activeProvider.generate({
          systemPrompt,
          message: contextSnapshot.message,
          history: contextSnapshot.history,
          context: contextSnapshot,
          toolExecutor,
          trace,
        });
      } else {
        throw providerError;
      }
    }

    const toolLog = toolExecutor.getExecutionLog();
    const usage = providerResult?.usage || null;
    const estimatedCost = estimateAiCost({
      usage,
      pricing: this.config.pricing,
    });
    const observability = trace.finish("ok", null, {
      provider: activeProvider.name,
      toolCount: toolLog.length,
    });
    const audit = recordAiAudit({
      traceId: observability.traceId,
      correlationId,
      contextId: contextSnapshot.contextId,
      flowType: contextSnapshot.flowType,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: observability.endedAt,
      durationMs: observability.durationMs,
      status: error ? "fallback" : "ok",
      provider: providerResult?.provider || activeProvider.name,
      model: providerResult?.model || null,
      user: contextSnapshot.user,
      screen: contextSnapshot.screen,
      entity: contextSnapshot.entity,
      message: contextSnapshot.message,
      prompt: systemPrompt,
      input: payload,
      responseText: providerResult?.responseText || "",
      responseSummary: summarizeResponseText(providerResult?.responseText),
      toolsUsed: toolLog,
      toolNames: toolLog.map((item) => item.name),
      usage,
      estimatedCost,
      observability,
      error,
    });

    return {
      traceId: observability.traceId,
      correlationId,
      contextId: contextSnapshot.contextId,
      flowType: contextSnapshot.flowType,
      provider: providerResult?.provider || activeProvider.name,
      model: providerResult?.model || null,
      response: {
        text: providerResult?.responseText || "",
        toolsUsed: toolLog,
        usage,
        estimatedCost,
      },
      context: {
        screen: contextSnapshot.screen,
        entity: contextSnapshot.entity,
      },
      auditId: audit.id,
      observability,
    };
  }
}
