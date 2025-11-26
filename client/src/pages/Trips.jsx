import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import useDevices from "../lib/hooks/useDevices";
import { useTranslation } from "../lib/i18n.js";
import useReports from "../lib/hooks/useReports.js";
import { formatAddress } from "../lib/format-address.js";
import { formatDateTime, pickCoordinate } from "../lib/monitoring-helpers.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import {
  buildColumnDefaults,
  loadColumnPreferences,
  mergeColumnPreferences,
  reorderColumns,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";

const COLUMN_STORAGE_KEY = "tripsReportColumns";

export default function Trips() {
  const { locale } = useTranslation();
  const navigate = useNavigate();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generateTripsReport } = useReports();
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const [draggingColumn, setDraggingColumn] = useState(null);

  const tripsRaw = Array.isArray(data?.trips) ? data.trips : Array.isArray(data) ? data : [];
  const trips = useMemo(() => {
    const list = Array.isArray(tripsRaw) ? tripsRaw.filter(Boolean) : [];
    return [...list].sort((a, b) => {
      const startA = parseDate(a?.startTime) || parseDate(a?.start) || new Date(0);
      const startB = parseDate(b?.startTime) || parseDate(b?.start) || new Date(0);
      return startB.getTime() - startA.getTime();
    });
  }, [tripsRaw]);
  const lastGeneratedAt = data?.__meta?.generatedAt;

  const deviceNameById = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      map.set(device.id ?? device.uniqueId, device.name ?? device.uniqueId ?? device.id);
    });
    return map;
  }, [devices]);

  const handleOpenRoute = useCallback(
    (trip) => {
      const id = trip?.deviceId ?? deviceId;
      if (!id || !trip?.startTime || !trip?.endTime) return;
      const search = new URLSearchParams({ deviceId: String(id), from: trip.startTime, to: trip.endTime });
      navigate(`/reports/route?${search.toString()}`);
    },
    [deviceId, navigate],
  );

  const columns = useMemo(
    () => [
      {
        key: "vehicle",
        label: "Veículo",
        defaultVisible: true,
        render: (trip) => trip.deviceName || deviceNameById.get(trip.deviceId) || "—",
      },
      {
        key: "startTime",
        label: "Início",
        defaultVisible: true,
        render: (trip) => formatDateTime(parseDate(trip.startTime), locale),
      },
      {
        key: "endTime",
        label: "Fim",
        defaultVisible: true,
        render: (trip) => formatDateTime(parseDate(trip.endTime), locale),
      },
      {
        key: "duration",
        label: "Duração",
        defaultVisible: true,
        render: (trip) => formatDuration(trip.duration),
      },
      {
        key: "distance",
        label: "Distância",
        defaultVisible: true,
        render: (trip) => formatDistance(trip.distance),
      },
      {
        key: "averageSpeed",
        label: "Vel. média",
        defaultVisible: true,
        render: (trip) => formatSpeed(trip.averageSpeed),
      },
      {
        key: "maxSpeed",
        label: "Vel. máx.",
        defaultVisible: true,
        render: (trip) => formatSpeed(trip.maxSpeed),
      },
      {
        key: "startAddress",
        label: "Local de início",
        defaultVisible: true,
        render: (trip) =>
          formatLocation({
            address: trip.startAddress,
            shortAddress: trip.startShortAddress,
            formattedAddress: trip.startFormattedAddress,
            lat: trip.startLat,
            lon: trip.startLon,
          }),
      },
      {
        key: "endAddress",
        label: "Local de fim",
        defaultVisible: true,
        render: (trip) =>
          formatLocation({
            address: trip.endAddress,
            shortAddress: trip.endShortAddress,
            formattedAddress: trip.endFormattedAddress,
            lat: trip.endLat,
            lon: trip.endLon,
          }),
      },
      {
        key: "actions",
        label: "Ações",
        defaultVisible: true,
        fixed: true,
        render: (trip) => (
          <button
            type="button"
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-1 text-xs font-semibold text-white hover:bg-white/10"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenRoute(trip);
            }}
          >
            Ver rota
          </button>
        ),
      },
    ],
    [deviceNameById, handleOpenRoute, locale],
  );

  const defaultPreferences = useMemo(() => buildColumnDefaults(columns), [columns]);
  const [columnPrefs, setColumnPrefs] = useState(defaultPreferences);

  useEffect(() => {
    if (loadingPreferences) return;
    const saved = preferences?.tripsReportColumns || loadColumnPreferences(COLUMN_STORAGE_KEY, defaultPreferences);
    setColumnPrefs(mergeColumnPreferences(defaultPreferences, saved));
  }, [defaultPreferences, loadingPreferences, preferences]);

  useEffect(() => {
    saveColumnPreferences(COLUMN_STORAGE_KEY, columnPrefs);
  }, [columnPrefs]);

  const persistColumnPrefs = useCallback(
    (next) => {
      saveColumnPreferences(COLUMN_STORAGE_KEY, next);
      if (!loadingPreferences) {
        savePreferences({ tripsReportColumns: { visible: next.visible, order: next.order } }).catch((prefError) =>
          console.warn("Falha ao salvar preferências de colunas", prefError),
        );
      }
    },
    [loadingPreferences, savePreferences],
  );

  const handleToggleColumn = useCallback(
    (key) => {
      const column = columns.find((item) => item.key === key);
      if (column?.fixed) return;
      setColumnPrefs((current) => {
        const isVisible = current.visible?.[key] !== false;
        const next = { ...current, visible: { ...current.visible, [key]: !isVisible } };
        persistColumnPrefs(next);
        return next;
      });
    },
    [columns, persistColumnPrefs],
  );

  const handleReorderColumn = useCallback(
    (fromKey, toKey) => {
      setColumnPrefs((current) => {
        const next = reorderColumns(current, fromKey, toKey, defaultPreferences);
        if (!next || next === current) return current;
        persistColumnPrefs(next);
        return next;
      });
    },
    [defaultPreferences, persistColumnPrefs],
  );

  const handleRestoreColumns = useCallback(() => {
    setColumnPrefs(defaultPreferences);
    persistColumnPrefs(defaultPreferences);
  }, [defaultPreferences, persistColumnPrefs]);

  const visibleColumns = useMemo(() => resolveVisibleColumns(columns, columnPrefs), [columns, columnPrefs]);
  const visibleColumnCount = Math.max(1, visibleColumns.length);

  async function handleSubmit(event) {
    event.preventDefault();
    setFeedback(null);
    const validationMessage = validateFields({ deviceId, from, to });
    if (validationMessage) {
      setFormError(validationMessage);
      return;
    }
    setFormError("");
    setFetching(true);
    try {
      await generateTripsReport({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString(), type: "all" });
      setFeedback({ type: "success", message: "Relatório de viagens criado com sucesso." });
    } catch (requestError) {
      const friendlyMessage = "Não foi possível carregar as viagens. Verifique o período ou tente novamente.";
      setFeedback({ type: "error", message: friendlyMessage });
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    setSelectedTrip((current) => {
      if (!current) return null;
      const match = trips.find(
        (trip) => trip.deviceId === current.deviceId && trip.startTime === current.startTime && trip.endTime === current.endTime,
      );
      return match || null;
    });
  }, [trips]);

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatório de viagens</h2>
          <p className="text-xs opacity-70">Visão macro das viagens realizadas pelo veículo.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="block text-xs uppercase tracking-wide opacity-60">Veículo / dispositivo</span>
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
            <span className="block text-xs uppercase tracking-wide opacity-60">Início</span>
            <input
              type="datetime-local"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide opacity-60">Fim</span>
            <input
              type="datetime-local"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </label>

          <div className="md:col-span-4 flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
              disabled={fetching || loading || !deviceId}
            >
              {fetching ? "Gerando…" : "Gerar"}
            </button>
          </div>
        </form>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}
        {formError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>}
        {feedback && feedback.type === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{feedback.message}</div>
        )}
        {lastGeneratedAt && <p className="text-xs text-white/60">Última geração: {formatDate(lastGeneratedAt)}</p>}
      </section>

      <section className="card space-y-4">
        <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Viagens</h3>
            <p className="text-xs opacity-70">Cada linha representa uma viagem consolidada.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-60">{trips.length} registros</span>
            <div className="relative">
              <button
                type="button"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white hover:border-white/30"
                onClick={() => setShowColumns((open) => !open)}
              >
                Colunas
              </button>
              {showColumns && (
                <div className="absolute right-0 z-10 mt-2 w-64 rounded-xl border border-white/10 bg-[#0f141c] p-3 text-sm text-white/80 shadow-xl">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">Organizar colunas</div>
                  {columns.map((column) => (
                    <div
                      key={column.key}
                      className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 ${draggingColumn === column.key ? "bg-white/10" : ""}`}
                      draggable={!column.fixed}
                      onDragStart={() => !column.fixed && setDraggingColumn(column.key)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleReorderColumn(draggingColumn, column.key);
                        setDraggingColumn(null);
                      }}
                      onDragEnd={() => setDraggingColumn(null)}
                    >
                      <div className="flex items-center gap-2">
                        {!column.fixed ? <span className="text-xs text-white/50">☰</span> : null}
                        <span className="text-white/70">{column.label}</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={columnPrefs.visible?.[column.key] !== false}
                        disabled={column.fixed}
                        onChange={() => handleToggleColumn(column.key)}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    className="mt-3 w-full rounded-lg border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
                    onClick={handleRestoreColumns}
                  >
                    Restaurar padrão
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide opacity-60">
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column.key} className="py-2 pr-6">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {loading && (
                <tr>
                  <td colSpan={visibleColumnCount} className="py-4 text-center text-sm opacity-60">
                    Processando viagens…
                  </td>
                </tr>
              )}
              {!loading && !trips.length && (
                <tr>
                  <td colSpan={visibleColumnCount} className="py-4 text-center text-sm opacity-60">
                    {lastGeneratedAt
                      ? "Nenhuma viagem encontrada para o período selecionado."
                      : "Gere um relatório para visualizar as viagens."}
                  </td>
                </tr>
              )}
              {trips.map((trip) => (
                <tr
                  key={`${trip.deviceId}-${trip.startTime}-${trip.endTime}`}
                  className={`cursor-pointer hover:bg-white/5 ${selectedTrip === trip ? "bg-white/5" : ""}`}
                  onClick={() => setSelectedTrip(trip)}
                >
                  {visibleColumns.map((column) => (
                    <td key={column.key} className="py-2 pr-6 text-white/80">
                      {column.render ? column.render(trip) : column.getValue?.(trip, { locale })}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedTrip && (
        <section className="card space-y-3">
          <header className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-lg font-semibold">Detalhes da viagem</h4>
              <p className="text-xs opacity-70">Resumo baseado nos dados retornados pelo backend.</p>
            </div>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
              onClick={() => handleOpenRoute(selectedTrip)}
            >
              Abrir pontos da rota
            </button>
          </header>

          <dl className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            <SummaryItem label="Veículo" value={selectedTrip.deviceName || deviceNameById.get(selectedTrip.deviceId) || "—"} />
            <SummaryItem
              label="Início"
              value={formatDateTime(parseDate(selectedTrip.startTime), locale)}
            />
            <SummaryItem label="Fim" value={formatDateTime(parseDate(selectedTrip.endTime), locale)} />
            <SummaryItem label="Duração" value={formatDuration(selectedTrip.duration)} />
            <SummaryItem label="Distância" value={formatDistance(selectedTrip.distance)} />
            <SummaryItem label="Velocidade média" value={formatSpeed(selectedTrip.averageSpeed)} />
            <SummaryItem label="Velocidade máxima" value={formatSpeed(selectedTrip.maxSpeed)} />
            <SummaryItem
              label="Local de início"
              value={formatLocation({
                address: selectedTrip.startAddress,
                shortAddress: selectedTrip.startShortAddress,
                formattedAddress: selectedTrip.startFormattedAddress,
                lat: selectedTrip.startLat,
                lon: selectedTrip.startLon,
              })}
            />
            <SummaryItem
              label="Local de fim"
              value={formatLocation({
                address: selectedTrip.endAddress,
                shortAddress: selectedTrip.endShortAddress,
                formattedAddress: selectedTrip.endFormattedAddress,
                lat: selectedTrip.endLat,
                lon: selectedTrip.endLon,
              })}
            />
          </dl>
        </section>
      )}
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

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateFields({ deviceId, from, to }) {
  if (!deviceId) return "Selecione um dispositivo para gerar o relatório.";
  if (!from || !to) return "Preencha as datas de início e fim.";
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return "Datas inválidas.";
  if (fromDate > toDate) return "A data inicial deve ser anterior à final.";
  return "";
}

function formatDuration(durationSeconds) {
  const number = Number(durationSeconds);
  if (!Number.isFinite(number)) return "—";
  const hours = Math.floor(number / 3600);
  const minutes = Math.floor((number % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatDistance(distanceMeters) {
  const number = Number(distanceMeters);
  if (!Number.isFinite(number)) return "—";
  const km = number / 1000;
  return `${km.toFixed(2)} km`;
}

function formatSpeed(speed) {
  const number = Number(speed);
  if (!Number.isFinite(number)) return "—";
  return `${Math.round(number)} km/h`;
}

function formatLocation({ address, shortAddress, formattedAddress, lat, lon }) {
  const preferred = formatAddress({ address, shortAddress, formattedAddress });
  if (preferred && preferred !== "—") return preferred;
  const latitude = pickCoordinate([lat]);
  const longitude = pickCoordinate([lon]);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
  return "—";
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-white">{value ?? "—"}</dd>
    </div>
  );
}
