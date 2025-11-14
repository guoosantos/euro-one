import React, { useMemo, useState } from 'react';
import MapImpl from '../components/_MapImpl.jsx';
import useDevices from '../lib/hooks/useDevices';

const DEFAULT_COLUMNS = {
  name: true,
  plate: true,
  speed: true,
  ignition: true,
  status: true,
};

function toKey(value) {
  if (value === null || value === undefined) return null;
  try {
    return String(value);
  } catch (error) {
    return null;
  }
}

function getDeviceKey(device) {
  return (
    toKey(device?.id) ??
    toKey(device?.deviceId) ??
    toKey(device?.device_id) ??
    toKey(device?.uniqueId) ??
    toKey(device?.unique_id) ??
    toKey(device?.identifier)
  );
}

function pickCoordinate(values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function pickSpeed(position) {
  const candidates = [position?.speed, position?.attributes?.speed];
  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) {
      return Math.round(number);
    }
  }
  return null;
}

function getIgnition(position, device) {
  const candidates = [
    position?.attributes?.ignition,
    position?.ignition,
    device?.attributes?.ignition,
  ];

  for (const value of candidates) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }

  return null;
}

function getLastUpdate(position) {
  if (!position) return null;
  const candidates = [
    position.serverTime,
    position.time,
    position.fixTime,
    position.server_time,
    position.fixtime,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }

  return null;
}

function formatDateTime(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '—';
  }
  try {
    return value.toLocaleString();
  } catch (error) {
    return value.toISOString();
  }
}

function formatIgnition(value) {
  if (value === true) return 'Ligada';
  if (value === false) return 'Desligada';
  return '—';
}

function isOnline(position, offlineThresholdMinutes = 5) {
  const lastUpdate = getLastUpdate(position);
  if (!lastUpdate) return false;
  const diffMinutes = (Date.now() - lastUpdate.getTime()) / 1000 / 60;
  return diffMinutes <= offlineThresholdMinutes;
}

function deriveStatus(position) {
  if (!position) return 'offline';
  if (!isOnline(position)) return 'offline';
  if (position?.attributes?.blocked || position?.blocked) return 'blocked';
  if (position?.attributes?.alarm || position?.alarm) return 'alert';
  return 'online';
}

function getStatusBadge(position) {
  const status = deriveStatus(position);
  switch (status) {
    case 'online':
      return {
        label: 'Online',
        status,
        className: 'inline-flex items-center rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-200',
      };
    case 'alert':
      return {
        label: 'Alerta',
        status,
        className: 'inline-flex items-center rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200',
      };
    case 'blocked':
      return {
        label: 'Bloqueado',
        status,
        className: 'inline-flex items-center rounded-full bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-200',
      };
    default:
      return {
        label: 'Offline',
        status,
        className: 'inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/60',
      };
  }
}

function MapSection({ markers }) {
  if (!Array.isArray(markers) || markers.length === 0) {
    return (
      <div className="flex h-[360px] items-center justify-center text-sm text-white/50">
        Nenhuma posição disponível no momento.
      </div>
    );
  }

  if (typeof window === 'undefined') {
    return (
      <div className="flex h-[360px] flex-col justify-center gap-2 p-6 text-sm text-white/60">
        <strong className="text-white/80">Mapa indisponível.</strong>
        <span>O mapa interativo só é exibido no ambiente do navegador.</span>
      </div>
    );
  }

  try {
    return <MapImpl markers={markers} height={360} className="bg-[#0b0f17]" />;
  } catch (mapError) {
    console.error('Monitoring map render failed', mapError);
    return (
      <div className="flex h-[360px] flex-col justify-center gap-2 p-6 text-sm text-white/60">
        <strong className="text-white/80">Não foi possível carregar o mapa.</strong>
        <span>O mapa interativo está temporariamente indisponível. Tente novamente em instantes.</span>
      </div>
    );
  }
}

export default function Monitoring() {
  const { devices, positionsByDeviceId, loading, error, reload, stats } = useDevices();

  const [query, setQuery] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);

  const safeDevices = useMemo(() => (Array.isArray(devices) ? devices : []), [devices]);
  const safePositions = useMemo(
    () => (positionsByDeviceId && typeof positionsByDeviceId === 'object' ? positionsByDeviceId : {}),
    [positionsByDeviceId],
  );

  const deviceIndex = useMemo(() => {
    const map = new Map();
    for (const device of safeDevices) {
      const key = getDeviceKey(device);
      if (key) {
        map.set(key, device);
      }
    }
    return map;
  }, [safeDevices]);

  const filteredDevices = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return safeDevices;
    return safeDevices.filter((device) => {
      const name = (device?.name ?? device?.vehicle ?? device?.alias ?? '').toString().toLowerCase();
      const plate = (device?.plate ?? device?.registrationNumber ?? device?.uniqueId ?? '').toString().toLowerCase();
      return name.includes(term) || plate.includes(term);
    });
  }, [safeDevices, query]);

  const markers = useMemo(() => {
    const entries = Object.entries(safePositions);
    return entries
      .map(([key, position]) => {
        const lat = pickCoordinate([
          position?.latitude,
          position?.lat,
          position?.latitude_deg,
          position?.lat_deg,
        ]);
        const lng = pickCoordinate([
          position?.longitude,
          position?.lon,
          position?.lng,
          position?.lng_deg,
        ]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const device = deviceIndex.get(key) ?? null;
        const label = device?.name ?? device?.vehicle ?? position?.name ?? `Dispositivo ${key}`;
        const address = position?.address ?? position?.attributes?.address ?? device?.address ?? 'Endereço indisponível';
        const ignition = formatIgnition(getIgnition(position, device));
        const speed = pickSpeed(position);
        const lastUpdate = formatDateTime(getLastUpdate(position));
        const badge = getStatusBadge(position);

        return {
          id: key,
          lat,
          lng,
          status: badge.status,
          label,
          popup: (
            <div className="space-y-2 text-xs text-white/80">
              <div className="text-sm font-medium text-white">{label}</div>
              <div className="flex items-center justify-between">
                <span>Status</span>
                <span className="font-medium">{badge.label}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Velocidade</span>
                <span>{speed !== null ? `${speed} km/h` : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Ignição</span>
                <span>{ignition}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Atualizado</span>
                <span>{lastUpdate}</span>
              </div>
              <div className="text-[11px] text-white/60">{address}</div>
            </div>
          ),
        };
      })
      .filter(Boolean);
  }, [safePositions, deviceIndex]);

  const onlineCount = useMemo(() => {
    let count = 0;
    for (const device of safeDevices) {
      const key = getDeviceKey(device);
      if (!key) continue;
      if (isOnline(safePositions[key])) {
        count += 1;
      }
    }
    return count;
  }, [safeDevices, safePositions]);

  const summary = {
    total: stats?.total ?? safeDevices.length,
    withPosition: stats?.withPosition ?? Object.keys(safePositions).length,
    online: onlineCount,
    offline: Math.max(0, (stats?.total ?? safeDevices.length) - onlineCount),
  };

  const visibleColumnCount = Math.max(1, Object.values(columns).filter(Boolean).length);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="font-medium">Não foi possível atualizar os dados de telemetria.</div>
          <div className="mt-1 text-xs opacity-80">{error.message ?? 'Verifique a conexão com o servidor e tente novamente.'}</div>
        </div>
      )}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="card p-6">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-white">Mapa em tempo real</div>
              <div className="text-xs text-white/50">
                {loading ? 'Sincronizando telemetria…' : `Dispositivos com posição: ${summary.withPosition}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn"
                onClick={reload}
                disabled={loading}
              >
                {loading ? 'Atualizando…' : 'Recarregar'}
              </button>
            </div>
          </header>

          <div className="mt-4 overflow-hidden rounded-xl border border-white/5 bg-white/5">
            <MapSection markers={markers} />
          </div>
        </div>

        <aside className="card space-y-4 p-6">
          <div>
            <div className="text-sm font-medium text-white">Resumo da frota</div>
            <div className="text-xs text-white/50">Estado consolidado das integrações Traccar.</div>
          </div>
          <dl className="space-y-3 text-sm text-white/80">
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-white/60">Dispositivos cadastrados</dt>
              <dd className="text-base font-semibold text-white">{summary.total}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-white/60">Com posição válida</dt>
              <dd className="text-base font-semibold text-white">{summary.withPosition}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-white/60">Online agora</dt>
              <dd className="text-base font-semibold text-emerald-200">{summary.online}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <dt className="text-white/60">Sem sinal recente</dt>
              <dd className="text-base font-semibold text-white/70">{summary.offline}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="card">
        <header className="flex flex-col gap-4 border-b border-white/5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-medium text-white">Telemetria da frota</div>
            <div className="text-xs text-white/50">
              {loading ? 'Atualizando dados em tempo real…' : `Exibindo ${filteredDevices.length} dispositivos`}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por veículo ou placa"
              className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-white/40 focus:border-primary/40 focus:outline-none sm:w-64"
            />
            <div className="relative">
              <button
                type="button"
                className="btn"
                onClick={() => setShowColumns((value) => !value)}
              >
                Colunas
              </button>
              {showColumns && (
                <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-sm text-white/80 shadow-xl">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                    Exibir colunas
                  </div>
                  {Object.keys(columns).map((key) => (
                    <label key={key} className="flex items-center justify-between py-1">
                      <span className="capitalize text-white/70">{key}</span>
                      <input
                        type="checkbox"
                        checked={columns[key]}
                        onChange={() => setColumns((current) => ({ ...current, [key]: !current[key] }))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/40">
              <tr>
                {columns.name && <th className="px-6 py-3">Veículo</th>}
                {columns.plate && <th className="px-6 py-3">Placa</th>}
                {columns.speed && <th className="px-6 py-3">Velocidade</th>}
                {columns.ignition && <th className="px-6 py-3">Ignição</th>}
                {columns.status && <th className="px-6 py-3">Status</th>}
              </tr>
            </thead>
            <tbody>
              {filteredDevices.map((device) => {
                const key = getDeviceKey(device);
                const position = key ? safePositions[key] : undefined;
                const speed = pickSpeed(position);
                const ignition = getIgnition(position, device);
                const badge = getStatusBadge(position);

                return (
                  <tr key={key ?? device?.id ?? device?.uniqueId} className="border-b border-white/5 last:border-none">
                    {columns.name && (
                      <td className="px-6 py-3 text-white">
                        {device?.name ?? device?.vehicle ?? device?.alias ?? '—'}
                      </td>
                    )}
                    {columns.plate && (
                      <td className="px-6 py-3 text-white/70">
                        {device?.plate ?? device?.registrationNumber ?? '—'}
                      </td>
                    )}
                    {columns.speed && (
                      <td className="px-6 py-3 text-white/80">{speed !== null ? `${speed} km/h` : '—'}</td>
                    )}
                    {columns.ignition && (
                      <td className="px-6 py-3 text-white/80">{formatIgnition(ignition)}</td>
                    )}
                    {columns.status && (
                      <td className="px-6 py-3">
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                    )}
                  </tr>
                );
              })}

              {!loading && filteredDevices.length === 0 && (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-6 py-8 text-center text-sm text-white/50">
                    Nenhum dispositivo encontrado para os filtros aplicados.
                  </td>
                </tr>
              )}

              {loading && (
                <tr>
                  <td colSpan={visibleColumnCount} className="px-6 py-8 text-center text-sm text-white/50">
                    Carregando dados de telemetria…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
