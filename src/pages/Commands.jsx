import React, { useMemo, useState } from "react";
import useCommands from "../lib/hooks/useCommands";
import useDevices from "../lib/hooks/useDevices";

export default function Commands() {
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { commands, loading, error, reload, sendCommand } = useCommands({ autoRefreshMs: 45_000 });

  const [deviceId, setDeviceId] = useState("");
  const [type, setType] = useState("engineStop");
  const [attributes, setAttributes] = useState("{}");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState(null);

  const list = Array.isArray(commands) ? commands : [];

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError(null);
    if (!deviceId || !type) {
      setFormError(new Error("Selecione o dispositivo e o tipo do comando"));
      return;
    }
    let parsedAttributes = {};
    if (attributes.trim()) {
      try {
        parsedAttributes = JSON.parse(attributes);
      } catch (_parseError) {
        setFormError(new Error("Atributos devem ser um JSON válido"));
        return;
      }
    }
    setSending(true);
    try {
      await sendCommand({ deviceId, type, attributes: parsedAttributes });
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

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-3">
          <label className="text-sm md:col-span-1">
            <span className="block text-xs uppercase tracking-wide opacity-60">Dispositivo</span>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
              required
            >
              <option value="" disabled>
                Selecione um dispositivo
              </option>
              {devices.map((device) => (
                <option key={device.id ?? device.uniqueId} value={device.id ?? device.uniqueId}>
                  {device.name ?? device.uniqueId ?? device.id}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Tipo</span>
            <input
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="engineStop"
              required
            />
          </label>

          <label className="text-sm md:col-span-3">
            <span className="block text-xs uppercase tracking-wide opacity-60">Atributos (JSON)</span>
            <textarea
              value={attributes}
              onChange={(event) => setAttributes(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="md:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={sending}
            >
              {sending ? "Enviando…" : "Enviar comando"}
            </button>
            <button
              type="button"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-white/10"
              onClick={reload}
            >
              Atualizar lista
            </button>
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
