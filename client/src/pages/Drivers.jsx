import React from "react";
import useDrivers from "../lib/hooks/useDrivers";
import PageHeader from "../components/ui/PageHeader.jsx";

export default function Drivers() {
  const { drivers, loading, error, reload } = useDrivers();

  const list = Array.isArray(drivers) ? drivers : [];

  return (
    <div className="space-y-6">
      <PageHeader
        overline="Central de motoristas"
        title="Motoristas"
        subtitle="Lista proveniente do cadastro do Traccar."
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
                <th className="py-2 pr-6">Documento</th>
                <th className="py-2 pr-6">Telefone</th>
                <th className="py-2 pr-6">Atribuído a</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Carregando motoristas…
                  </td>
                </tr>
              )}
              {!loading && !list.length && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-sm opacity-60">
                    Nenhum motorista sincronizado.
                  </td>
                </tr>
              )}
              {list.map((driver) => (
                <tr key={driver.id ?? driver.name ?? driver.uniqueId} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white/80">{driver.name || "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{driver.document || driver.identification || "—"}</td>
                  <td className="py-2 pr-6 text-white/70">{driver.phone || driver.attributes?.phone || "—"}</td>
                  <td className="py-2 pr-6 text-white/50">{driver.deviceId || driver.device?.name || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
