import React, { useEffect, useMemo, useState } from "react";
import { CoreApi } from "../lib/coreApi.js";

export default function Stock() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const list = await CoreApi.listDevices();
        if (active) {
          setDevices(Array.isArray(list) ? list : []);
        }
      } catch (requestError) {
        if (active) {
          setError(requestError instanceof Error ? requestError : new Error("Falha ao carregar equipamentos"));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const total = devices.length;
    const active = devices.filter((device) => device.vehicleId).length;
    const available = total - active;
    const online = devices.filter((device) => device.connectionStatus === "online").length;
    const offline = devices.filter((device) => device.connectionStatus === "offline" || device.connectionStatus === "never").length;
    return { total, active, available, online, offline };
  }, [devices]);

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error.message}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Equipamentos" value={loading ? "…" : summary.total} description="Total cadastrados" />
        <StatCard title="Ativos" value={loading ? "…" : summary.active} description="Vinculados a veículos" />
        <StatCard title="Em estoque" value={loading ? "…" : summary.available} description="Disponíveis para instalação" />
        <StatCard title="Online" value={loading ? "…" : summary.online} description="Com comunicação recente" />
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        {loading
          ? "Carregando resumo do estoque…"
          : `Atualmente ${summary.active} equipamentos estão em uso, ${summary.available} disponíveis e ${summary.offline} sem comunicação.`}
      </div>
    </div>
  );
}

function StatCard({ title, value, description }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-white">
      <div className="text-sm text-white/60">{title}</div>
      <div className="mt-2 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-white/50">{description}</div>
    </div>
  );
}
