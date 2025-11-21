import React, { useMemo, useState } from "react";

import Button from "../ui/Button";
import Input from "../ui/Input";
import useCommands from "../lib/hooks/useCommands";
import useDevices from "../lib/hooks/useDevices";

const COMMAND_TEMPLATES = [
  {
    type: "engineStop",
    label: "Bloquear motor",
    description: "Corta a ignição do veículo imediatamente (engineStop).",
    fields: [],
  },
  {
    type: "engineResume",
    label: "Desbloquear motor",
    description: "Restaura a ignição e libera o veículo (engineResume).",
    fields: [],
  },
  {
    type: "positionPeriodic",
    label: "Atualização periódica",
    description: "Solicita que o rastreador envie posições em um intervalo fixo.",
    fields: [
      {
        name: "frequency",
        label: "Intervalo (segundos)",
        type: "number",
        min: 10,
        defaultValue: 60,
      },
    ],
  },
  {
    type: "setSpeedLimit",
    label: "Limite de velocidade",
    description: "Define o limite máximo de velocidade aceito pelo dispositivo.",
    fields: [
      {
        name: "speed",
        label: "Velocidade máxima (km/h)",
        type: "number",
        min: 5,
        defaultValue: 80,
      },
    ],
  },
];

const MANUAL_TYPE = "manual";

function buildFieldDefaults(template) {
  if (!template?.fields) return {};
  return template.fields.reduce((acc, field) => {
    acc[field.name] = field.defaultValue ?? "";
    return acc;
  }, {});
}

export default function Commands() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { commands, loading, error, reload, sendCommand } = useCommands({ autoRefreshMs: 45_000 });

  const [deviceId, setDeviceId] = useState("");
  const [typeOption, setTypeOption] = useState(COMMAND_TEMPLATES[0].type);
  const [manualType, setManualType] = useState("");
  const [fieldValues, setFieldValues] = useState(buildFieldDefaults(COMMAND_TEMPLATES[0]));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedJson, setAdvancedJson] = useState("{}");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);

  const list = Array.isArray(commands) ? commands : [];

  const selectedTemplate =
    typeOption === MANUAL_TYPE ? null : COMMAND_TEMPLATES.find((item) => item.type === typeOption) || null;
  const selectedFields = selectedTemplate?.fields ?? [];

  const templateAttributes = useMemo(() => {
    if (!selectedTemplate) return {};
    return selectedFields.reduce((acc, field) => {
      const value = fieldValues[field.name];
      if (value === undefined || value === "") {
        return acc;
      }
      if (field.type === "number") {
        const numericValue = Number(value);
        acc[field.name] = Number.isNaN(numericValue) ? value : numericValue;
      } else {
        acc[field.name] = value;
      }
      return acc;
    }, {});
  }, [fieldValues, selectedTemplate]);

  const parsedAdvanced = useMemo(() => {
    if (!advancedJson.trim()) {
      return { data: {}, error: null };
    }
    try {
      return { data: JSON.parse(advancedJson), error: null };
    } catch (_parseError) {
      return { data: {}, error: "JSON inválido" };
    }
  }, [advancedJson]);

  const previewAttributes = useMemo(
    () => ({ ...templateAttributes, ...(showAdvanced ? parsedAdvanced.data : {}) }),
    [parsedAdvanced.data, showAdvanced, templateAttributes],
  );
  const previewJson = useMemo(() => JSON.stringify(previewAttributes, null, 2), [previewAttributes]);

  function applyTemplate(value) {
    setTypeOption(value);
    if (value === MANUAL_TYPE) {
      setFieldValues({});
      return;
    }
    const template = COMMAND_TEMPLATES.find((item) => item.type === value);
    setFieldValues(buildFieldDefaults(template));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    const resolvedType = typeOption === MANUAL_TYPE ? manualType.trim() : selectedTemplate?.type;
    if (!deviceId || !resolvedType) {
      setFormError(new Error("Selecione o dispositivo e o tipo do comando"));
      return;
    }
    if (showAdvanced && parsedAdvanced.error) {
      setFormError(new Error("Corrija o JSON avançado antes de enviar"));
      return;
    }
    const mergedAttributes = showAdvanced ? previewAttributes : templateAttributes;
    setSending(true);
    try {
      await sendCommand({ deviceId, type: resolvedType, attributes: mergedAttributes });
      reload();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError : new Error("Erro ao enviar comando"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Enviar comandos</h2>
          <p className="text-xs opacity-70">Os comandos são encaminhados diretamente ao dispositivo via Traccar.</p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-sm md:col-span-1">
              <span className="block text-xs uppercase tracking-wide opacity-60">Dispositivo</span>
              <select
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2"
                required
              >
                <option value="" disabled>
                  Selecione um dispositivo
                </option>
                {devices
                  .map((device) => {
                    const id = device.deviceId ?? device.traccarId ?? device.id ?? device.uniqueId;
                    if (!id) return null;
                    return {
                      id,
                      label: device.name || device.uniqueId || id,
                    };
                  })
                  .filter(Boolean)
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label}
                    </option>
                  ))}
              </select>
            </label>

            <label className="text-sm md:col-span-1">
              <span className="block text-xs uppercase tracking-wide opacity-60">Tipo</span>
              <select
                value={typeOption}
                onChange={(event) => applyTemplate(event.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2"
              >
                {COMMAND_TEMPLATES.map((template) => (
                  <option key={template.type} value={template.type}>
                    {template.label}
                  </option>
                ))}
                <option value={MANUAL_TYPE}>Outro (preencher manualmente)</option>
              </select>
            </label>

            {typeOption === MANUAL_TYPE && (
              <label className="text-sm md:col-span-1">
                <span className="block text-xs uppercase tracking-wide opacity-60">Nome do comando</span>
                <Input
                  value={manualType}
                  onChange={(event) => setManualType(event.target.value)}
                  placeholder="Ex.: customCommand"
                  required
                />
              </label>
            )}
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-wide text-white/60">Atalhos de comandos</span>
            <div className="grid gap-3 md:grid-cols-2">
              {COMMAND_TEMPLATES.map((template) => (
                <button
                  key={template.type}
                  type="button"
                  onClick={() => applyTemplate(template.type)}
                  aria-pressed={typeOption === template.type}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-white/40 ${
                    typeOption === template.type
                      ? "border-primary/60 bg-primary/10 text-white"
                      : "border-white/10 bg-white/5 text-white/80 hover:border-white/30"
                  }`}
                >
                  <div className="text-white font-semibold">{template.label}</div>
                  <p className="mt-1 text-xs text-white/60">{template.description}</p>
                </button>
              ))}
            </div>
          </div>

          {selectedTemplate && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-white font-semibold">{selectedTemplate.label}</div>
                  <p className="text-xs text-white/60">{selectedTemplate.description}</p>
                </div>
                {selectedFields.length === 0 && (
                  <span className="text-xs text-white/50">Nenhum parâmetro adicional obrigatório.</span>
                )}
              </div>

              {selectedFields.length > 0 && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {selectedFields.map((field) => (
                    <label key={field.name} className="text-xs uppercase tracking-wide text-white/60">
                      {field.label}
                      <input
                        type={field.type === "number" ? "number" : "text"}
                        min={field.min}
                        value={fieldValues[field.name] ?? ""}
                        onChange={(event) =>
                          setFieldValues((prev) => ({
                            ...prev,
                            [field.name]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-xl border border-border bg-layer px-3 py-2"
                        required
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-white/50">Modo avançado</div>
            <Button type="button" variant="ghost" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? "Ocultar JSON" : "Editar atributos (JSON)"}
            </Button>
          </div>

          {showAdvanced && (
            <label className="text-sm block">
              <span className="block text-xs uppercase tracking-wide opacity-60">Atributos (JSON)</span>
              <textarea
                value={advancedJson}
                onChange={(event) => setAdvancedJson(event.target.value)}
                rows={4}
                className={`mt-1 w-full rounded-xl border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none ${
                  parsedAdvanced.error ? "border-red-500/60" : "border-border"
                }`}
              />
              {parsedAdvanced.error && (
                <span className="mt-1 block text-xs text-red-300">{parsedAdvanced.error}</span>
              )}
            </label>
          )}

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-white/60">
              <span>Pré-visualização do payload</span>
              <code className="text-white/80">
                {typeOption === MANUAL_TYPE ? manualType || "manual" : selectedTemplate?.type || "—"}
              </code>
            </div>
            <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-black/40 p-3 text-xs text-white/80">
              {previewJson}
            </pre>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={sending}>
              {sending ? "Enviando…" : "Enviar comando"}
            </Button>
            <Button type="button" variant="outline" onClick={reload}>
              Atualizar lista
            </Button>
          </div>
        </form>

        {(formError || error) && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {formError?.message || error?.message}
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Histórico de comandos</h3>
          <span className="text-xs opacity-60">{list.length} registros</span>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Dispositivo</th>
                <th className="py-2 pr-6">Tipo</th>
                <th className="py-2 pr-6">Enviado em</th>
                <th className="py-2 pr-6">Executado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Carregando comandos…
                  </td>
                </tr>
              )}
              {!loading && !list.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Nenhum comando encontrado para o período selecionado.
                  </td>
                </tr>
              )}
              {list.map((command) => (
                <tr key={command.id ?? `${command.deviceId}-${command.type}-${command.sentAt}`}
                  className="hover:bg-white/5"
                >
                  <td className="py-2 pr-6 text-white/80">{command.deviceId ?? command.device?.name ?? "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{command.type ?? "—"}</td>
                  <td className="py-2 pr-6 text-white/60">{formatDate(command.sentAt || command.sentTime)}</td>
                  <td className="py-2 pr-6 text-white/60">{formatDate(command.deliveredAt || command.resultTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch (_error) {
    return String(value);
  }
}
