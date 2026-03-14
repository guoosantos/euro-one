import { AI_FLOW_TYPES } from "../domain/flow-types.js";
import config from "../../config.js";

const BASE_RULES = [
  `Você é ${config.ai.assistantName}, o assistente operacional oficial da Euro One.`,
  "Responda em português do Brasil com linguagem operacional, objetiva e profissional.",
  "Nao invente fatos, estados, execucoes, confirmacoes humanas, comandos enviados ou ocorrencias abertas.",
  "Quando faltar dado, diga explicitamente que nao foi possivel confirmar.",
  "Use dados do contexto e das tools para fundamentar a resposta.",
  "Nunca afirme que uma acao critica foi executada; no maximo sugira um proximo passo.",
  "Respeite o escopo de permissao do usuario e o contexto operacional informado.",
  "Se houver ambiguidade, priorize clareza, risco operacional e rastreabilidade.",
];

const FLOW_INSTRUCTIONS = {
  [AI_FLOW_TYPES.CHAT]:
    "Atue como copiloto operacional. Responda perguntas do operador, investigue contexto quando necessario e sinalize riscos, lacunas e proximos passos.",
  [AI_FLOW_TYPES.SUMMARIZE_EVENT]:
    "Produza um resumo curto e auditavel do evento/ocorrencia, destacando fato confirmado, impacto operacional, prioridade sugerida e proximos passos.",
  [AI_FLOW_TYPES.INVESTIGATE_VEHICLE]:
    "Investigue o veiculo com foco em status atual, ultimas horas, eventos, comunicacao, ignicao e sinais de desvio ou inconsistencia.",
  [AI_FLOW_TYPES.PRIORITIZE_ALERT]:
    "Analise o alerta em contexto e recomende prioridade operacional responsavel, com justificativa curta e sem exagero.",
  [AI_FLOW_TYPES.LEARNING_QUESTIONS]:
    "Atue como curador do modo de aprendizado do SENTINEL. Gere perguntas curtas e objetivas para o admin ensinar regras, nomenclaturas, prioridade e formato de exibicao. Nao diga que o sistema aprende sozinho sem supervisao humana.",
};

function formatContextBlock(context = {}) {
  const lines = [];
  const screen = context.screen || {};
  const entity = context.entity || {};
  const user = context.user || {};
  if (screen.routePath || screen.title) {
    lines.push(`Tela atual: ${screen.title || screen.routePath || "nao informada"}`);
  }
  if (entity.entityType || entity.entityId || entity.label || entity.plate) {
    lines.push(
      `Entidade em foco: tipo=${entity.entityType || "nao informada"} id=${entity.entityId || "n/a"} label=${entity.label || entity.plate || "n/a"}`,
    );
  }
  if (user.role || user.clientId) {
    lines.push(`Usuario: role=${user.role || "n/a"} clientId=${user.clientId || "n/a"}`);
  }
  if (context.summary) {
    lines.push(`Resumo operacional conhecido: ${context.summary}`);
  }
  const learningEntries = Array.isArray(context.learning?.entries) ? context.learning.entries : [];
  if (learningEntries.length) {
    lines.push("Aprendizado supervisionado ativo:");
    learningEntries.slice(0, 8).forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.title ? `${entry.title}: ` : ""}${entry.content}`);
    });
  }
  return lines.length ? `CONTEXTO OPERACIONAL\n${lines.join("\n")}` : "";
}

export function buildSystemPrompt({ flowType, context } = {}) {
  const flowInstruction = FLOW_INSTRUCTIONS[flowType] || FLOW_INSTRUCTIONS[AI_FLOW_TYPES.CHAT];
  const contextBlock = formatContextBlock(context);
  return [BASE_RULES.join("\n"), "", flowInstruction, contextBlock].filter(Boolean).join("\n");
}

export function buildFallbackPrompt({ flowType } = {}) {
  const flowInstruction = FLOW_INSTRUCTIONS[flowType] || FLOW_INSTRUCTIONS[AI_FLOW_TYPES.CHAT];
  return `${flowInstruction}\nSe o modelo nao estiver disponivel, produza uma resposta operacional curta e claramente limitada aos dados confirmados.`;
}
