import React, { useEffect, useRef } from "react";

const getCommandKey = (command) => command?.code || command?.id || "";

const resolveParamKey = (param, index) => param?.key || param?.id || param?.name || `param_${index}`;

const resolveParamLabel = (param, index) => {
  const label = typeof param?.label === "string" ? param.label.trim() : "";
  if (label) return label;
  const help = typeof param?.helpText === "string" ? param.helpText.trim() : "";
  if (help && param?.type !== "boolean") return help;
  const name = typeof param?.name === "string" ? param.name.trim() : "";
  if (name) return name;
  return `Parâmetro ${Number.isFinite(index) ? index + 1 : 1}`;
};

function resolveOptionValue(option) {
  if (option && typeof option === "object") {
    return option.value ?? option.id ?? option.label ?? "";
  }
  return option ?? "";
}

export default function CommandSendModal({
  isOpen,
  onClose,
  commands,
  loading,
  error,
  search,
  onSearchChange,
  selectedKey,
  onSelectCommand,
  selectedCommand,
  params,
  onParamChange,
  onSubmit,
  sending,
  sendError,
  status = "idle",
  message = null,
}) {
  if (!isOpen) return null;
  const hasCommands = Array.isArray(commands) && commands.length > 0;
  const isSuccess = status === "success";
  const isWarning = status === "warning";
  const isDone = isSuccess || isWarning;
  const selectRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const target = selectedKey ? confirmRef.current : selectRef.current;
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }, [isOpen, selectedKey]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-2xl rounded-xl border border-white/10 bg-[#0f141c] p-5 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-white/50">Enviar comando</p>
            <h3 className="text-lg font-semibold text-white">Selecione o comando</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:text-white"
          >
            Fechar
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs text-white/70">
          <label className="space-y-1 text-[11px] text-white/60">
            <span>Buscar comando</span>
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              placeholder="Filtrar por nome ou descrição"
            />
          </label>

          <label className="space-y-1 text-[11px] text-white/60">
            <span>Comando</span>
            <select
              ref={selectRef}
              value={selectedKey || ""}
              onChange={(event) => onSelectCommand(event.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
            >
              <option value="">Selecione</option>
              {commands.map((command) => {
                const key = getCommandKey(command);
                return (
                  <option key={key} value={key}>
                    {command.name || command.description || key}
                  </option>
                );
              })}
            </select>
          </label>

          {loading && <p className="text-xs text-white/60">Carregando comandos...</p>}
          {error && <p className="text-xs text-red-300">{error.message || "Erro ao carregar comandos."}</p>}
          {!loading && !error && !hasCommands && (
            <p className="text-xs text-white/50">Nenhum comando disponível para este protocolo.</p>
          )}

          {selectedCommand?.parameters?.length ? (
            <div className="space-y-2 rounded-lg border border-white/10 bg-white/5 p-3">
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/50">Parâmetros</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {selectedCommand.parameters.map((param, index) => {
                  const paramKey = resolveParamKey(param, index);
                  const label = resolveParamLabel(param, index);
                  const resolvedValue =
                    params?.[paramKey] ??
                    (param.defaultValue !== undefined && param.defaultValue !== null ? param.defaultValue : "");
                  const type = String(param?.type || "text").toLowerCase();
                  const options = Array.isArray(param?.options) ? param.options : null;
                  const inputType = type === "number" || type === "int" ? "number" : "text";

                  if (options) {
                    return (
                      <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                        <span>{label}</span>
                        <select
                          value={resolvedValue}
                          onChange={(event) => onParamChange(paramKey, event.target.value)}
                          className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        >
                          {options.map((option) => {
                            const optionValue = resolveOptionValue(option);
                            const optionLabel =
                              option && typeof option === "object" ? option.label ?? option.value ?? optionValue : optionValue;
                            return (
                              <option key={optionValue} value={optionValue}>
                                {optionLabel}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    );
                  }

                  if (type === "textarea") {
                    return (
                      <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                        <span>{label}</span>
                        <textarea
                          value={resolvedValue}
                          onChange={(event) => onParamChange(paramKey, event.target.value)}
                          rows={4}
                          className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        />
                      </label>
                    );
                  }

                  if (type === "boolean") {
                    return (
                      <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                        <span>{label}</span>
                        <select
                          value={String(resolvedValue)}
                          onChange={(event) => onParamChange(paramKey, event.target.value === "true")}
                          className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                        >
                          <option value="">Selecione</option>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      </label>
                    );
                  }

                  return (
                    <label key={paramKey} className="space-y-1 text-[11px] text-white/60">
                      <span>{label}</span>
                      <input
                        type={inputType}
                        value={resolvedValue}
                        min={param.min}
                        max={param.max}
                        step={param.step}
                        onChange={(event) => onParamChange(paramKey, event.target.value)}
                        className="w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {message && status !== "success" && status !== "warning" && (
            <p className={`text-xs ${status === "error" ? "text-red-300" : "text-amber-300"}`}>{message}</p>
          )}
          {sendError && !message && !isWarning && !isSuccess && (
            <p className="text-xs text-red-300">{sendError}</p>
          )}
          {isWarning && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              {message || "Comando enviado com aviso."}
            </div>
          )}
          {isSuccess && (
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {message || "Comando enviado com sucesso."}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70"
          >
            {isDone ? "Fechar" : "Cancelar"}
          </button>
          {!isDone && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={sending || !selectedKey}
              ref={confirmRef}
              className={`rounded-lg border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                sending || !selectedKey
                  ? "border-white/10 bg-white/5 text-white/40"
                  : "border-primary/60 bg-primary/20 text-white"
              }`}
            >
              {sending ? "Enviando..." : "Confirmar envio"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
