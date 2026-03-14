import { createToolRegistry } from "./tool-registry.js";
import { isActionRequestCategory } from "../domain/tool-categories.js";

function sanitizeToolInput(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function buildValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_TOOL_INPUT";
  return error;
}

function validateRequiredFields(schema, input) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const field of required) {
    const value = input?.[field];
    if (value === null || value === undefined || value === "") {
      throw buildValidationError(`Campo obrigatorio ausente para a tool: ${field}`);
    }
  }
}

export function createToolExecutor({ runtime, trace } = {}) {
  const registry = createToolRegistry(runtime);
  const toolMap = new Map(registry.map((tool) => [tool.name, tool]));
  const executions = [];

  async function executeTool(name, rawInput = {}) {
    const tool = toolMap.get(String(name));
    if (!tool) {
      const error = new Error(`Tool nao encontrada: ${name}`);
      error.status = 404;
      error.code = "TOOL_NOT_FOUND";
      throw error;
    }

    const input = sanitizeToolInput(rawInput);
    validateRequiredFields(tool.inputSchema, input);
    const span = trace?.startSpan?.(`tool:${tool.name}`, {
      toolName: tool.name,
      toolCategory: tool.category,
    });
    const startedAt = Date.now();
    try {
      const output = await tool.execute(input);
      const record = {
        name: tool.name,
        category: tool.category,
        input,
        output,
        status: "ok",
        durationMs: Date.now() - startedAt,
        confirmationPolicy: tool.confirmationPolicy || null,
      };
      executions.push(record);
      span?.finish?.("ok", null, { durationMs: record.durationMs });
      return record;
    } catch (error) {
      const record = {
        name: tool.name,
        category: tool.category,
        input,
        output: null,
        status: "error",
        durationMs: Date.now() - startedAt,
        error: {
          message: error?.message || String(error),
          code: error?.code || null,
          status: error?.status || error?.statusCode || null,
        },
      };
      executions.push(record);
      span?.finish?.("error", error, { durationMs: record.durationMs });
      throw error;
    }
  }

  return {
    listTools() {
      return registry.map((tool) => ({
        name: tool.name,
        category: tool.category,
        description: tool.description,
        inputSchema: tool.inputSchema,
        confirmationPolicy: tool.confirmationPolicy || null,
        isActionRequest: isActionRequestCategory(tool.category),
      }));
    },
    async executeTool(name, input) {
      return executeTool(name, input);
    },
    getExecutionLog() {
      return executions.map((item) => JSON.parse(JSON.stringify(item)));
    },
  };
}

