import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Menu, Search, Settings, User } from "lucide-react";

import { useUI } from "../lib/store";
import { useTenant } from "../lib/tenant-context";
import useDevices from "../lib/hooks/useDevices";
import { useLivePositions } from "../lib/hooks/useLivePositions";
import { useEvents } from "../lib/hooks/useEvents";
import { buildFleetState } from "../lib/fleet-utils";

const statusLabels = {
  online: "Online",
  alert: "Alerta",
  offline: "Offline",
  blocked: "Bloqueado",
};

export function Topbar({ title }) {
  const toggleSidebar = useUI((state) => state.toggle);
  const { tenantId, setTenantId, tenant, tenants } = useTenant();
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  const { devices } = useDevices({ tenantId });
  const { positions } = useLivePositions({ tenantId, refreshInterval: 120 * 1000 });
  const { events: recentEvents } = useEvents({ tenantId, limit: 3, autoRefreshMs: 120 * 1000 });

  const fleetIndex = useMemo(() => {
    const { rows } = buildFleetState(devices, positions, { tenantId });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      plate: row.plate,
      status: row.status,
    }));
  }, [devices, positions, tenantId]);

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const term = query.trim().toLowerCase();
    return fleetIndex
      .filter((item) => {
        const name = item.name?.toLowerCase() ?? "";
        const plate = item.plate?.toLowerCase() ?? "";
        return name.includes(term) || plate.includes(term);
      })
      .slice(0, 5);
  }, [query, fleetIndex]);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (searchResults.length) {
      navigate(`/vehicles?vehicle=${searchResults[0].id}`);
      setQuery("");
      setFocused(false);
    }
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-[#0b0f17]/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3">
        <div className="flex flex-1 items-center gap-3">
          <button type="button" className="btn md:hidden" onClick={toggleSidebar} aria-label="Abrir menu">
            <Menu size={18} />
          </button>

          <div>
            <div className="text-sm font-medium leading-none">{tenant?.name ?? "Euro One"}</div>
            <div className="text-[11px] text-white/50">{title || tenant?.segment || "Plataforma de monitoramento"}</div>
          </div>
        </div>

        <form className="relative hidden flex-1 md:block" onSubmit={handleSubmit} role="search">
          <label className="relative block">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-white/40">
              <Search size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 120)}
              placeholder="Busca global — veículo, placa, motorista, alerta"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/5 pl-10 pr-3 text-sm text-white placeholder:text-white/40 focus:border-primary/50 focus:outline-none"
            />
          </label>

          {focused && (query ? (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0f141c] shadow-2xl">
              {searchResults.length ? (
                <ul>
                  {searchResults.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={`/vehicles?vehicle=${item.id}`}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-white/5"
                        onClick={() => {
                          setQuery("");
                          setFocused(false);
                        }}
                      >
                        <span>
                          <span className="font-medium">{item.name}</span>
                          <span className="ml-2 text-xs text-white/40">{item.plate}</span>
                        </span>
                        <span className="text-xs text-white/50">{statusLabels[item.status] ?? "—"}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-4 py-3 text-sm text-white/50">Nenhum veículo encontrado.</div>
              )}
            </div>
          ) : (
            <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0f141c] shadow-2xl">
              <div className="px-4 py-2 text-xs uppercase tracking-wider text-white/40">Últimos alertas</div>
              <ul>
                {recentEvents.map((event) => (
                  <li key={event.id ?? `${event.deviceId}-${event.time}` } className="px-4 py-2 text-sm text-white/70">
                    <div className="font-medium">{event.type ?? event.event}</div>
                    <div className="text-xs text-white/40">{formatDate(event.time ?? event.eventTime ?? event.serverTime)}</div>
                  </li>
                ))}
                {!recentEvents.length && <li className="px-4 py-2 text-sm text-white/50">Sem eventos recentes.</li>}
              </ul>
            </div>
          ))}
        </form>

        <div className="flex items-center gap-2">
          <select
            value={tenantId ?? ""}
            onChange={(event) => setTenantId(event.target.value)}
            className="hidden h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white hover:border-primary/40 focus:border-primary/60 focus:outline-none md:block"
          >
            {tenants.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>

          <button className="btn" type="button" title="Central de alertas">
            <Bell size={18} />
          </button>
          <button className="btn" type="button" title="Configurações">
            <Settings size={18} />
          </button>
          <button className="btn" type="button" title="Perfil do usuário">
            <User size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}

function formatDate(value) {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString();
  } catch (error) {
    return "—";
  }
}
