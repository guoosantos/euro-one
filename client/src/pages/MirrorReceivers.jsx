import React, { useEffect, useMemo, useState } from "react";

import api from "../lib/api";
import { API_ROUTES } from "../lib/api-routes";
import { useTenant } from "../lib/tenant-context";
import DataTable from "../components/ui/DataTable";
import PageHeader from "../components/ui/PageHeader";

const EMPTY_LIST = [];

export default function MirrorReceivers() {
  const { tenantId, user } = useTenant();
  const [mirrors, setMirrors] = useState(EMPTY_LIST);
  const [vehicles, setVehicles] = useState(EMPTY_LIST);
  const [loading, setLoading] = useState(false);

  const targetClientId = tenantId || user?.clientId;

  useEffect(() => {
    if (!targetClientId) return;
    let isMounted = true;
    async function load() {
      setLoading(true);
      try {
        const mirrorResponse = await api.get(API_ROUTES.mirrors, { params: { targetClientId } });
        const mirrorList = mirrorResponse?.data?.mirrors || mirrorResponse?.data || [];
        const vehicleResponse = await api.get(API_ROUTES.core.vehicles);
        const vehicleList = vehicleResponse?.data?.vehicles || vehicleResponse?.data || [];
        if (!isMounted) return;
        setMirrors(Array.isArray(mirrorList) ? mirrorList : EMPTY_LIST);
        setVehicles(Array.isArray(vehicleList) ? vehicleList : EMPTY_LIST);
      } catch (loadError) {
        console.error("Erro ao carregar espelhamentos", loadError);
        if (isMounted) {
          setMirrors(EMPTY_LIST);
          setVehicles(EMPTY_LIST);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [targetClientId]);

  const vehicleById = useMemo(
    () => new Map(vehicles.map((vehicle) => [String(vehicle.id), vehicle])),
    [vehicles],
  );

  return (
    <div className="space-y-6 text-white">
      <PageHeader
        title="Espelhamento"
        subtitle="Veja os veículos espelhados por clientes parceiros dentro do período ativo."
      />

      <section className="border border-white/10 p-6">
        {loading ? (
          <p className="text-sm text-white/70">Carregando espelhamentos…</p>
        ) : (
          <DataTable>
            <thead className="text-left text-xs uppercase tracking-wide text-white/60">
              <tr>
                <th className="py-2 pr-4">Cliente origem</th>
                <th className="py-2 pr-4">Veículos disponíveis</th>
                <th className="py-2 pr-4">Período</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {mirrors.map((mirror) => {
                const vehicleLabels = (mirror.vehicleIds || [])
                  .map((id) => vehicleById.get(String(id)))
                  .filter(Boolean)
                  .map((vehicle) => vehicle.plate || vehicle.name || vehicle.model || "Veículo");
                return (
                  <tr key={mirror.id} className="hover:bg-white/5">
                    <td className="py-2 pr-4 text-white">
                      {String(mirror.ownerClientId).slice(0, 6)}
                    </td>
                    <td className="py-2 pr-4 text-white/70">
                      {vehicleLabels.length ? vehicleLabels.join(", ") : `${mirror.vehicleIds?.length || 0} veículos`}
                    </td>
                    <td className="py-2 pr-4 text-white/70">
                      {mirror.startAt || "—"} • {mirror.endAt || "—"}
                    </td>
                  </tr>
                );
              })}
              {!mirrors.length && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-sm text-white/60">
                    Nenhum espelhamento disponível no momento.
                  </td>
                </tr>
              )}
            </tbody>
          </DataTable>
        )}
      </section>
    </div>
  );
}
