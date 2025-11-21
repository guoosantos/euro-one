import React from "react";
import useNotifications from "../lib/hooks/useNotifications";

export default function Notifications() {
  const { notifications, loading, error, reload } = useNotifications({ autoRefreshMs: 60_000 });

  const list = Array.isArray(notifications) ? notifications : [];

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Notificações configuradas</h2>
            <p className="text-xs opacity-70">Monitoramento contínuo das regras de alerta do Traccar.</p>
          </div>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-white/10"
          >
            Atualizar
          </button>
        </header>

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            {error.message}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                <th className="py-2 pr-6">Nome</th>
                <th className="py-2 pr-6">Tipo</th>
                <th className="py-2 pr-6">Meio</th>
                <th className="py-2 pr-6">Ativo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Carregando notificações…
                  </td>
                </tr>
              )}
              {!loading && !list.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Nenhuma notificação encontrada.
                  </td>
                </tr>
              )}
              {list.map((notification) => (
                <tr key={notification.id ?? notification.type} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{notification.name || notification.description || "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{notification.type || "—"}</td>
                  <td className="py-2 pr-6 text-white/60">{formatChannels(notification?.notificators)}</td>
                  <td className="py-2 pr-6 text-white/60">{notification.always ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatChannels(channels) {
  if (!channels) return "—";
  if (Array.isArray(channels)) return channels.join(", ");
  if (typeof channels === "string") return channels;
  return Object.keys(channels)
    .filter((key) => channels[key])
    .join(", ");
}
