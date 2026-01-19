import React from "react";
import useGroups from "../lib/hooks/useGroups";
import PageHeader from "../components/ui/PageHeader.jsx";

export default function Groups() {
  const { groups, loading, error, reload } = useGroups();

  const list = Array.isArray(groups) ? groups : [];

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Central de grupos"
        title="Grupos"
        subtitle="Sincronizados diretamente com o Traccar."
        actions={
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-white/10"
          >
            Atualizar
          </button>
        }
      />
      <section className="card space-y-4">
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
                <th className="py-2 pr-6">Descrição</th>
                <th className="py-2 pr-6">Responsável</th>
                <th className="py-2 pr-6">ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Carregando grupos…
                  </td>
                </tr>
              )}
              {!loading && !list.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Nenhum grupo encontrado.
                  </td>
                </tr>
              )}
              {list.map((group) => (
                <tr key={group.id ?? group.name ?? group.uniqueId} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{group.name || "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{group.description || group.attributes?.description || "—"}</td>
                  <td className="py-2 pr-6 text-white/60">{group.managedBy || group.userId || "—"}</td>
                  <td className="py-2 pr-6 text-white/50">{group.id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
