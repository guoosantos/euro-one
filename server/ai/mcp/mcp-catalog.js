export function buildMcpCatalog(toolDefinitions = []) {
  return {
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      category: tool.category,
    })),
    resources: [
      { name: "operational-context", description: "Contexto de tela e entidade operacional atual." },
      { name: "ai-audit-history", description: "Historico auditavel das interacoes de IA." },
    ],
    prompts: [
      { name: "operational-system", description: "Prompt principal do assistente operacional SENTINEL." },
      { name: "summarize-event", description: "Prompt especializado para resumir eventos/ocorrencias." },
    ],
    contextProviders: [
      { name: "screen-context-builder", description: "Monta contexto de tela e entidade para IA operacional." },
    ],
  };
}
