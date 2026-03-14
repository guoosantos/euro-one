import express from "express";

import { authenticate } from "../../middleware/auth.js";
import { authorizeAnyPermission } from "../../middleware/permissions.js";
import { requireAdminGeneralAccess } from "../../middleware/admin-general.js";
import { AIService } from "../application/ai-service.js";
import { AIOrchestrator } from "../application/ai-orchestrator.js";
import { createProviderFactory } from "../providers/provider-factory.js";
import { createToolRuntime } from "../tools/tool-runtime.js";
import { createToolExecutor } from "../tools/tool-executor.js";
import { listAiAudit } from "../audit/ai-audit-handler.js";
import { buildContextSnapshot } from "../context/context-builder.js";
import { buildMcpCatalog } from "../mcp/mcp-catalog.js";
import { createLearningEntry, listLearningEntries } from "../learning/learning-store.js";
import { recordAuditEvent, resolveRequestIp } from "../../services/audit-log.js";
import config from "../../config.js";

const router = express.Router();

const providerFactory = createProviderFactory(config.ai);
const aiService = new AIService({
  orchestrator: new AIOrchestrator({
    providerFactory,
    config: config.ai,
  }),
});
const authorizeOperationalAi = authorizeAnyPermission({
  permissions: [
    { menuKey: "primary", pageKey: "monitoring" },
    { menuKey: "primary", pageKey: "events" },
    { menuKey: "primary", pageKey: "trips" },
    { menuKey: "primary", pageKey: "devices", subKey: "devices-list" },
    { menuKey: "fleet", pageKey: "services", subKey: "service-orders" },
  ],
});

router.use(authenticate);
router.use((req, res, next) => authorizeOperationalAi(req, res, next));

router.get("/ai/tools", async (req, res, next) => {
  try {
    const contextSnapshot = buildContextSnapshot(req, {});
    const runtime = createToolRuntime({ req, contextSnapshot });
    const executor = createToolExecutor({ runtime, trace: null });
    const tools = executor.listTools();
    res.json({
      tools,
      mcpCatalog: buildMcpCatalog(tools),
      provider: providerFactory.resolvePrimaryProvider().name,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/ai/history/:contextId", async (req, res, next) => {
  try {
    const items = listAiAudit({
      contextId: req.params.contextId,
      userId: req.user?.id,
      clientId: req.clientId || req.user?.clientId || null,
      limit: req.query?.limit,
    });
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.post("/ai/chat", async (req, res, next) => {
  try {
    const result = await aiService.chat(req, req.body || {});
    res.set("X-AI-Trace-Id", result.traceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/ai/summarize-event", async (req, res, next) => {
  try {
    const result = await aiService.summarizeEvent(req, req.body || {});
    res.set("X-AI-Trace-Id", result.traceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/ai/investigate-vehicle", async (req, res, next) => {
  try {
    const result = await aiService.investigateVehicle(req, req.body || {});
    res.set("X-AI-Trace-Id", result.traceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/ai/prioritize-alert", async (req, res, next) => {
  try {
    const result = await aiService.prioritizeAlert(req, req.body || {});
    res.set("X-AI-Trace-Id", result.traceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/ai/learning", requireAdminGeneralAccess, async (req, res, next) => {
  try {
    const routePath = req.query?.routePath ? String(req.query.routePath) : null;
    const entityType = req.query?.entityType ? String(req.query.entityType) : null;
    const entries = listLearningEntries({ routePath, entityType, limit: req.query?.limit });
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

router.post("/ai/learning", requireAdminGeneralAccess, async (req, res, next) => {
  try {
    const entry = createLearningEntry({
      ...req.body,
      createdBy: {
        id: req.user?.id,
        name: req.user?.name || req.user?.username || req.user?.email,
      },
    });
    recordAuditEvent({
      clientId: req.clientId || req.user?.clientId || null,
      category: "ai-learning",
      action: "AI learning entry created",
      status: "Concluído",
      user: {
        id: req.user?.id,
        name: req.user?.name || req.user?.username || req.user?.email,
      },
      ipAddress: resolveRequestIp(req),
      relatedId: entry.id,
      details: {
        category: entry.category,
        routePath: entry.routePath,
        entityType: entry.entityType,
        title: entry.title,
      },
    });
    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

router.post("/ai/learning/questions", requireAdminGeneralAccess, async (req, res, next) => {
  try {
    const message =
      req.body?.message ||
      "Gere perguntas curtas para eu ensinar o SENTINEL a responder melhor nesta tela, considerando prioridade, nomenclatura e formato ideal de exibicao.";
    const result = await aiService.learningQuestions(req, {
      ...req.body,
      message,
    });
    res.set("X-AI-Trace-Id", result.traceId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
