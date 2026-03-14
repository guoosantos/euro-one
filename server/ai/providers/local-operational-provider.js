import { AIProvider } from "./ai-provider.js";
import { AI_FLOW_TYPES } from "../domain/flow-types.js";

const OPERATIONAL_TZ_OFFSET_HOURS = -3;

function buildTextLine(parts = []) {
  return parts.filter(Boolean).join(" ");
}

function normalizePlateCandidate(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function extractPlateFromMessage(message) {
  const tokens = String(message || "")
    .toUpperCase()
    .split(/[^A-Z0-9-]+/)
    .map((item) => normalizePlateCandidate(item))
    .filter(Boolean);

  return tokens.find((item) => /^[A-Z]{3}\d{4}$/.test(item) || /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(item)) || null;
}

function detectRequestedHours(message) {
  const match = String(message || "").match(/(\d+)\s*h/i);
  const hours = Number(match?.[1]);
  return Number.isFinite(hours) && hours > 0 ? hours : 6;
}

function buildOperationalDayRange(dayOffset = 0) {
  const offsetMs = OPERATIONAL_TZ_OFFSET_HOURS * 60 * 60 * 1000;
  const shiftedNow = new Date(Date.now() + offsetMs);
  shiftedNow.setUTCHours(0, 0, 0, 0);
  shiftedNow.setUTCDate(shiftedNow.getUTCDate() + dayOffset);

  const startUtc = new Date(shiftedNow.getTime() - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return {
    from: startUtc.toISOString(),
    to: endUtc.toISOString(),
  };
}

function detectTimeTarget(message) {
  const normalized = String(message || "").toLowerCase();
  if (/\bontem\b/.test(normalized)) {
    return buildOperationalDayRange(-1);
  }
  if (/\bhoje\b/.test(normalized)) {
    return buildOperationalDayRange(0);
  }
  return { hours: detectRequestedHours(message) };
}

function buildTargetFromContext(message, context) {
  return {
    vehicleId: context?.entity?.entityId || undefined,
    plate: context?.entity?.plate || extractPlateFromMessage(message) || undefined,
  };
}

function chooseTools({ message, flowType, context }) {
  const normalized = String(message || "").toLowerCase();
  const baseTarget = buildTargetFromContext(message, context);
  const timeTarget = detectTimeTarget(message);

  if (flowType === AI_FLOW_TYPES.SUMMARIZE_EVENT) {
    return [
      { name: "consultarResumoDeOcorrencia", input: baseTarget },
      { name: "gerarResumoDeEvento", input: baseTarget },
    ];
  }

  if (flowType === AI_FLOW_TYPES.INVESTIGATE_VEHICLE) {
    return [
      { name: "consultarResumoOperacional", input: { ...baseTarget, ...timeTarget } },
      { name: "listarEventosRecentes", input: { ...baseTarget, ...timeTarget, limit: 12 } },
      { name: "consultarStatusComunicacao", input: baseTarget },
    ];
  }

  if (flowType === AI_FLOW_TYPES.PRIORITIZE_ALERT) {
    return [
      { name: "consultarAlertasRelacionados", input: baseTarget },
      { name: "sugerirPrioridadeDeAtendimento", input: baseTarget },
    ];
  }

  if (/prioridade|critico|cr[ií]tico/.test(normalized)) {
    return [{ name: "sugerirPrioridadeDeAtendimento", input: baseTarget }];
  }
  if (/desvio/.test(normalized)) {
    return [{ name: "analisarPossivelDesvio", input: { ...baseTarget, ...timeTarget } }];
  }
  if (/igni|suspeit/.test(normalized)) {
    return [{ name: "analisarMudancaSuspeitaDeIgnicao", input: { ...baseTarget, ...timeTarget } }];
  }
  if (/repasse|resumo/.test(normalized)) {
    return [{ name: "prepararResumoParaRepasseOperacional", input: baseTarget }];
  }
  if (/alerta/.test(normalized)) {
    return [{ name: "consultarAlertasRelacionados", input: baseTarget }];
  }
  if (/o que fez|fez ontem|fez hoje|evento|aconteceu|ultimas|últimas|trajeto|rota/.test(normalized)) {
    return [
      { name: "listarEventosRecentes", input: { ...baseTarget, ...timeTarget, limit: 10 } },
      { name: "consultarDadosDeTrajeto", input: { ...baseTarget, ...timeTarget } },
      { name: "consultarUltimaPosicao", input: baseTarget },
    ];
  }
  return [{ name: "gerarResumoOperacional", input: { ...baseTarget, ...timeTarget } }];
}

function buildLearningQuestions(context = {}) {
  const questions = [];
  const screenTitle = context?.screen?.title || "esta tela";
  const summary = String(context?.summary || "").toLowerCase();
  const entries = Array.isArray(context?.learning?.entries) ? context.learning.entries : [];
  const hasPriorityRule = entries.some((entry) => /prioridade|critic/i.test(`${entry.title || ""} ${entry.content || ""}`));
  const hasLayoutRule = entries.some((entry) => /layout|exibi|mostrar|card|painel/i.test(`${entry.title || ""} ${entry.content || ""}`));
  const hasGlossaryRule = entries.some((entry) => /gloss[aá]rio|nome|r[oó]tulo|significa/i.test(`${entry.title || ""} ${entry.content || ""}`));

  if (!hasPriorityRule) {
    questions.push("Quais sinais devem elevar a prioridade operacional para alta nesta tela?");
  }
  if (!hasLayoutRule) {
    questions.push(`Como voce prefere que o ${screenTitle} organize alertas, detalhes e proximos passos na tela?`);
  }
  if (!hasGlossaryRule) {
    questions.push("Existe alguma nomenclatura interna ou sigla que o SENTINEL deve usar para responder melhor?");
  }
  if (/alerta|crit|risco/.test(summary)) {
    questions.push("Quando houver alerta pendente, qual criterio humano devo usar para destacar o caso sem abrir outra pagina?");
  }
  if (/comunica|offline|degradad/.test(summary)) {
    questions.push("Quando a comunicacao estiver degradada, qual tratativa padrao devo sugerir primeiro?");
  }

  return questions.slice(0, 4);
}

function summarizeEvents(events = []) {
  const items = (Array.isArray(events) ? events : []).slice(0, 5);
  if (!items.length) return null;
  return items
    .map((event) => `${event.type || "evento"}${event.eventTime ? ` em ${event.eventTime}` : ""}`)
    .join("; ");
}

function buildFailureText(toolResults, { message, context } = {}) {
  const requestedPlate = buildTargetFromContext(message, context).plate;
  const notFound = toolResults.find((item) => item?.error?.code === "VEHICLE_NOT_FOUND");
  if (notFound && requestedPlate) {
    return `Nao foi possivel localizar a placa ${requestedPlate} no escopo autorizado ou na base atual.`;
  }
  return "Nao foi possivel confirmar os dados necessarios para responder com seguranca no momento.";
}

function summarizeToolResult(toolResult) {
  const output = toolResult?.output || {};
  if (output.relaySummary) return output.relaySummary;
  if (output.generatedSummary) return output.generatedSummary;
  if (output.analysis) return output.analysis;
  if (output.recommendation) {
    return `Prioridade sugerida: ${output.recommendation.level}. ${output.recommendation.reason}`;
  }
  const lines = [];
  if (output.vehicle?.label) lines.push(`Veiculo: ${output.vehicle.label}.`);
  if (output.latestPosition?.fixTime) {
    lines.push(
      `Ultima posicao confirmada em ${output.latestPosition.fixTime}${output.latestPosition.address ? `, ${output.latestPosition.address}` : ""}.`,
    );
  }
  if (output.communicationStatus?.status) lines.push(`Comunicacao: ${output.communicationStatus.status}.`);
  if (output.ignition) lines.push(`Ignicao: ${output.ignition}.`);
  if (Array.isArray(output.events) && output.events.length) {
    lines.push(`Eventos confirmados: ${summarizeEvents(output.events)}.`);
  }
  if (Array.isArray(output.alerts) && output.alerts.length) lines.push(`Alertas relacionados: ${output.alerts.length}.`);
  if (Array.isArray(output.nextSteps) && output.nextSteps.length) {
    lines.push(`Proximos passos sugeridos: ${output.nextSteps.join(" ")}`);
  }
  return lines.length ? lines.join(" ") : "Nao foi possivel confirmar dados suficientes para responder com seguranca.";
}

export class LocalOperationalProvider extends AIProvider {
  constructor() {
    super("local-operational");
  }

  async generate({ message, flowType, context, toolExecutor } = {}) {
    if (flowType === AI_FLOW_TYPES.LEARNING_QUESTIONS) {
      const questions = buildLearningQuestions(context);
      const responseText = questions.length
        ? [
            "Perguntas de curadoria sugeridas para o modo de aprendizado:",
            ...questions.map((question, index) => `${index + 1}. ${question}`),
          ].join("\n")
        : "Nao identifiquei lacunas claras de curadoria agora. Se quiser, ensine regras de prioridade, nomenclatura ou formato de exibicao.";
      return {
        provider: this.name,
        model: null,
        responseText,
        usage: null,
        toolResults: [],
      };
    }

    const plannedTools = chooseTools({ message, flowType, context });
    const toolResults = [];

    for (const tool of plannedTools.slice(0, 3)) {
      try {
        const result = await toolExecutor.executeTool(tool.name, tool.input);
        toolResults.push(result);
      } catch (error) {
        toolResults.push({
          name: tool.name,
          status: "error",
          error: {
            message: error?.message || String(error),
            code: error?.code || null,
            status: error?.status || null,
          },
        });
      }
    }

    const successful = toolResults.filter((item) => item.status === "ok");
    const text = successful.length
      ? successful.map((item) => summarizeToolResult(item)).join(" ")
      : buildFailureText(toolResults, { message, context });

    return {
      provider: this.name,
      model: null,
      responseText: buildTextLine([
        text,
        "Baseado apenas em dados confirmados do sistema nesta sessao.",
      ]),
      usage: null,
      toolResults,
    };
  }
}
