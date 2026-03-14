import { AIProvider } from "./ai-provider.js";

function extractTextFromContent(content = []) {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      if (typeof entry?.text === "string") return entry.text;
      if (typeof entry?.value === "string") return entry.value;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractResponseText(payload = {}) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (item?.type === "message" && item?.role === "assistant") {
      const text = extractTextFromContent(item.content);
      if (text) return text;
    }
  }
  return "";
}

function extractFunctionCalls(payload = {}) {
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output.filter((item) => item?.type === "function_call" && item?.name);
}

function normalizeUsage(payload = {}) {
  const usage = payload?.usage || {};
  return {
    input_tokens: usage?.input_tokens ?? usage?.prompt_tokens ?? null,
    output_tokens: usage?.output_tokens ?? usage?.completion_tokens ?? null,
    total_tokens: usage?.total_tokens ?? null,
  };
}

function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildInitialInput({ history = [], message, context }) {
  const items = [];
  for (const entry of history.slice(-8)) {
    if (!entry?.role || !entry?.content) continue;
    items.push({
      role: entry.role,
      content: [{ type: "input_text", text: String(entry.content) }],
    });
  }
  const contextText = context?.summary ? `Contexto adicional: ${context.summary}\n\n` : "";
  items.push({
    role: "user",
    content: [{ type: "input_text", text: `${contextText}${message}`.trim() }],
  });
  return items;
}

export class OpenAIProvider extends AIProvider {
  constructor(config) {
    super("openai-responses");
    this.config = config;
  }

  isConfigured() {
    return Boolean(this.config?.apiKey);
  }

  async generate({
    systemPrompt,
    message,
    history,
    context,
    toolExecutor,
    trace,
  } = {}) {
    if (!this.isConfigured()) {
      const error = new Error("OPENAI_API_KEY nao configurada.");
      error.code = "OPENAI_NOT_CONFIGURED";
      error.status = 503;
      throw error;
    }

    const tools = toolExecutor.listTools().map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    }));

    let responseId = null;
    let usage = null;
    let input = buildInitialInput({ history, message, context });
    const toolResults = [];

    for (let step = 0; step < Math.max(1, Number(this.config.maxToolSteps) || 4); step += 1) {
      const payload = {
        model: this.config.model,
        instructions: systemPrompt,
        input,
        tools,
        tool_choice: "auto",
        temperature: this.config.temperature,
        metadata: {
          trace_id: trace?.traceId || null,
          context_id: context?.contextId || null,
          flow_type: context?.flowType || "chat",
        },
      };
      if (responseId) {
        payload.previous_response_id = responseId;
      }

      const providerResponse = await trace.runObserved(
        "provider:openai",
        async () => {
          const response = await fetch(`${this.config.baseUrl}/responses`, {
            method: "POST",
            headers: buildHeaders(this.config.apiKey),
            body: JSON.stringify(payload),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(data?.error?.message || `Falha OpenAI (${response.status})`);
            error.status = response.status;
            error.code = data?.error?.code || "OPENAI_PROVIDER_ERROR";
            throw error;
          }
          return data;
        },
        { model: this.config.model },
      );

      responseId = providerResponse?.id || responseId;
      usage = normalizeUsage(providerResponse);
      const functionCalls = extractFunctionCalls(providerResponse);

      if (!functionCalls.length) {
        const responseText = extractResponseText(providerResponse);
        return {
          provider: this.name,
          model: providerResponse?.model || this.config.model,
          responseText,
          usage,
          toolResults,
        };
      }

      const toolOutputs = [];
      for (const call of functionCalls) {
        let args = {};
        try {
          args = call?.arguments ? JSON.parse(call.arguments) : {};
        } catch (_error) {
          args = {};
        }
        const result = await toolExecutor.executeTool(call.name, args);
        toolResults.push(result);
        toolOutputs.push({
          type: "function_call_output",
          call_id: call.call_id || call.id,
          output: JSON.stringify(result.output || {}),
        });
      }
      input = toolOutputs;
    }

    const error = new Error("Limite de iteracoes de tool calling atingido.");
    error.code = "OPENAI_MAX_TOOL_STEPS";
    error.status = 502;
    throw error;
  }
}

