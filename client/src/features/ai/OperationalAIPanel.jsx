import React, { useMemo, useState } from "react";
import { Copy, Loader2, Sparkles, X } from "lucide-react";

import { useOperationalAI } from "./OperationalAIProvider.jsx";
import { AI_ASSISTANT_NAME } from "./ai-config.js";

function QuickActionButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-left text-xs font-medium text-white/80 transition hover:border-cyan-400/40 hover:bg-cyan-400/10 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

export function OperationalAIPanel() {
  const {
    open,
    setOpen,
    pending,
    history,
    error,
    screenContext,
    entityContext,
    sendMessage,
    runQuickAction,
    clearHistory,
  } = useOperationalAI();
  const [message, setMessage] = useState("");
  const [showContext, setShowContext] = useState(false);
  const quickActions = useMemo(
    () => [
      { key: "summary", label: "Resumo atual", action: "summarize" },
      { key: "investigate", label: "Investigar caso", action: "investigate" },
      { key: "priority", label: "Prioridade do alerta", action: "prioritize" },
    ],
    [],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    const next = String(message || "").trim();
    if (!next || pending) return;
    setMessage("");
    try {
      await sendMessage(next);
    } catch (_error) {
      // erro ja tratado no provider
    }
  };

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Fechar copiloto operacional"
          className="fixed inset-0 z-[12000] bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed right-0 top-0 z-[12001] flex h-screen w-full max-w-[460px] flex-col border-l border-white/10 bg-[#07111a] text-white shadow-2xl transition-transform duration-300 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-200">
              <Sparkles size={16} />
              {AI_ASSISTANT_NAME}
            </div>
            <div className="mt-1 text-xs text-white/60">
              {screenContext?.title || "Tela atual"}
              {entityContext?.plate ? ` • ${entityContext.plate}` : entityContext?.label ? ` • ${entityContext.label}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-white/10 p-2 text-white/70 transition hover:border-white/25 hover:text-white"
            aria-label="Fechar copiloto"
          >
            <X size={16} />
          </button>
        </div>

        <div className="border-b border-white/10 px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {quickActions.map((item) => (
              <QuickActionButton
                key={item.key}
                label={item.label}
                disabled={pending}
                onClick={() => runQuickAction(item.action).catch(() => {})}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowContext((current) => !current)}
              className="text-xs text-cyan-200/80 transition hover:text-cyan-100"
            >
              {showContext ? "Ocultar contexto" : "Mostrar contexto usado"}
            </button>
            <button
              type="button"
              onClick={clearHistory}
              className="text-xs text-white/50 transition hover:text-white/80"
            >
              Limpar historico
            </button>
          </div>
          {showContext ? (
            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/70">
              <div>Tela: {screenContext?.title || "n/a"}</div>
              <div>Rota: {screenContext?.routePath || "n/a"}</div>
              <div>Entidade: {entityContext?.entityType || "n/a"}</div>
              <div>Referencia: {entityContext?.plate || entityContext?.label || entityContext?.entityId || "n/a"}</div>
            </div>
          ) : null}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {!history.length ? (
            <div className="rounded-2xl border border-dashed border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-cyan-50/80">
              Pergunte sobre o contexto atual, resuma um caso, investigue um veiculo ou priorize um alerta.
            </div>
          ) : null}
          {history.map((item) => (
            <div
              key={item.id}
              className={`rounded-2xl border px-4 py-3 ${item.role === "assistant" ? "border-cyan-400/15 bg-cyan-400/8" : "border-white/10 bg-white/6"}`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">
                  {item.role === "assistant" ? "Copiloto" : "Operador"}
                </span>
                {item.role === "assistant" ? (
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(item.content || "")}
                    className="rounded-lg border border-white/10 p-1.5 text-white/50 transition hover:border-white/25 hover:text-white"
                    aria-label="Copiar resposta"
                  >
                    <Copy size={14} />
                  </button>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-6 text-white/88">{item.content}</div>
              {item.toolsUsed?.length ? (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/65">
                  <div className="mb-2 font-medium text-white/55">Tools consultadas</div>
                  <div className="flex flex-wrap gap-2">
                    {item.toolsUsed.map((tool) => (
                      <span key={`${item.id}-${tool.name}`} className="rounded-full border border-white/10 px-2 py-1">
                        {tool.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {pending ? (
            <div className="flex items-center gap-2 rounded-2xl border border-cyan-400/15 bg-cyan-400/8 px-4 py-3 text-sm text-cyan-50/80">
              <Loader2 size={16} className="animate-spin" />
              Analisando contexto operacional...
            </div>
          ) : null}
          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-white/10 px-4 py-4">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex.: Resuma a situacao desse veiculo nas ultimas 6 horas."
            rows={4}
            className="w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/35"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="text-xs text-white/45">Objetivo, auditavel e sem inventar dados.</div>
            <button
              type="submit"
              disabled={pending || !String(message || "").trim()}
              className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

export default OperationalAIPanel;
