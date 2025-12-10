import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import useDevices from "../lib/hooks/useDevices";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useTranslation } from "../lib/i18n.js";
import { formatAddress } from "../lib/format-address.js";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import {
  buildColumnDefaults,
  loadColumnPreferences,
  mergeColumnPreferences,
  reorderColumns,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";

const COLUMN_STORAGE_KEY = "routeReportColumns";

export default function ReportsRoute() {
  const { locale } = useTranslation();
  const location = useLocation();
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);
  const { data, loading, error, generate } = useReportsRoute();
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [deviceId, setDeviceId] = useState("");
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const [draggingColumn, setDraggingColumn] = useState(null);

  const points = Array.isArray(data?.positions) ? data.positions : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;
  const selectedDevice = useMemo(() => devices.find((device) => (device.id ?? device.uniqueId) === deviceId), [
    deviceId,
    devices,
  ]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryDevice = search.get("deviceId") || search.get("device");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    if (queryDevice && queryDevice !== deviceId) {
      setDeviceId(queryDevice);
    }
    const parsedFrom = asLocalDateTime(queryFrom);
    if (parsedFrom && parsedFrom !== from) {
      setFrom(parsedFrom);
    }
    const parsedTo = asLocalDateTime(queryTo);
    if (parsedTo && parsedTo !== to) {
      setTo(parsedTo);
    }

    if (!queryDevice || !queryFrom || !queryTo) return;
    const intendedFrom = parseDate(queryFrom);
    const intendedTo = parseDate(queryTo);
    if (!intendedFrom || !intendedTo) return;
    const intendedParams = {
      deviceId: queryDevice,
      from: intendedFrom.toISOString(),
      to: intendedTo.toISOString(),
    };
    const currentParams = data?.__meta?.params || {};
    const alreadyLoaded =
      currentParams.deviceId === intendedParams.deviceId &&
      currentParams.from === intendedParams.from &&
      currentParams.to === intendedParams.to;

    if (!alreadyLoaded && !loading && !fetching) {
      setFetching(true);
      generate(intendedParams)
        .catch(() => {
          // falha silenciosa ao tentar pré-carregar a partir do link de viagens.
        })
        .finally(() => setFetching(false));
    }
  }, [data?.__meta?.params, deviceId, fetching, from, generate, loading, location.search, to]);

  const routeSummary = useMemo(() => {
    if (!data) return null;

    const summary = data.summary || {};
    const params = data.__meta?.params || {};
    const first = points[0];
    const last = points[points.length - 1];

    const startTime =
      parseDate(summary.startTime ?? summary.start ?? summary.from ?? params.from) ||
      parseDate(first?.fixTime ?? first?.deviceTime ?? first?.serverTime);
    const endTime =
      parseDate(summary.endTime ?? summary.end ?? summary.to ?? params.to) ||
      parseDate(last?.fixTime ?? last?.deviceTime ?? last?.serverTime);

    const speeds = points
      .map((point) => pickSpeed(point))
      .filter((value) => value !== null && Number.isFinite(value));
    const averageSpeed =
      pickNumber([summary.averageSpeed]) ?? (speeds.length ? Math.round(speeds.reduce((acc, value) => acc + value, 0) / speeds.length) : null);
    const maxSpeed = pickNumber([summary.maxSpeed]) ?? (speeds.length ? Math.max(...speeds) : null);

    const durationMs = pickNumber([summary.durationMs, summary.duration]) ??
      (startTime && endTime ? endTime.getTime() - startTime.getTime() : null);
    const totalDistanceKm = (() => {
      const providedKm = pickNumber([summary.totalDistanceKm, summary.distanceKm]);
      if (Number.isFinite(providedKm)) return providedKm;
      const providedMeters = pickNumber([summary.totalDistance, summary.distanceMeters, summary.distance]);
      if (Number.isFinite(providedMeters)) return providedMeters / 1000;
      return computeDistanceKm(points);
    })();

    return {
      deviceName:
        summary.deviceName || selectedDevice?.name || selectedDevice?.vehicle || selectedDevice?.uniqueId || params.deviceId || "—",
      startTime,
      endTime,
      durationMs,
      totalDistanceKm,
      averageSpeed,
      maxSpeed,
      // Tempo parado/em movimento dependem do backend devolver esses campos ou um resumo dedicado.
      movementUnavailable: true,
    };
  }, [data, points, selectedDevice]);

  const tableColumns = useMemo(
    () => [
      {
        key: "gpsTime",
        label: "Hora GPS",
        defaultVisible: true,
        render: (point) => formatDateTime(parseDate(point.fixTime ?? point.deviceTime ?? point.serverTime), locale),
      },
      {
        key: "latitude",
        label: "Latitude",
        defaultVisible: true,
        render: (point) => {
          const value = pickCoordinate([point.latitude, point.lat, point.lat_deg, point.attributes?.latitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "longitude",
        label: "Longitude",
        defaultVisible: true,
        render: (point) => {
          const value = pickCoordinate([point.longitude, point.lon, point.lng, point.attributes?.longitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "speed",
        label: "Velocidade (km/h)",
        defaultVisible: true,
        render: (point) => {
          const speed = pickSpeed(point);
          return speed !== null ? `${speed} km/h` : "—";
        },
      },
      {
        key: "event",
        label: "Evento",
        defaultVisible: true,
        render: (point) => point.event || point.attributes?.event || point.type || "—",
      },
      {
        key: "address",
        label: "Endereço",
        defaultVisible: true,
        render: (point) => {
          const value = formatAddress(point);
          return value && value !== "—" ? value : "—";
        },
      },
    ],
    [locale],
  );

  const defaultPreferences = useMemo(() => buildColumnDefaults(tableColumns), [tableColumns]);
  const [columnPrefs, setColumnPrefs] = useState(defaultPreferences);

  useEffect(() => {
    if (loadingPreferences) return;
    const saved = preferences?.routeReportColumns || loadColumnPreferences(COLUMN_STORAGE_KEY, defaultPreferences);
    setColumnPrefs(mergeColumnPreferences(defaultPreferences, saved));
  }, [defaultPreferences, loadingPreferences, preferences]);

  useEffect(() => {
    saveColumnPreferences(COLUMN_STORAGE_KEY, columnPrefs);
  }, [columnPrefs]);

  const persistColumnPrefs = useCallback(
    (next) => {
      saveColumnPreferences(COLUMN_STORAGE_KEY, next);
      if (!loadingPreferences) {
        savePreferences({ routeReportColumns: { visible: next.visible, order: next.order } }).catch((prefError) =>
          console.warn("Falha ao salvar preferências de colunas", prefError),
        );
      }
    },
    [loadingPreferences, savePreferences],
  );

  const handleToggleColumn = useCallback(
    (key) => {
      const column = tableColumns.find((item) => item.key === key);
      if (column?.fixed) return;
      setColumnPrefs((current) => {
        const isVisible = current.visible?.[key] !== false;
        const next = { ...current, visible: { ...current.visible, [key]: !isVisible } };
        persistColumnPrefs(next);
        return next;
      });
    },
    [persistColumnPrefs, tableColumns],
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

  const visibleColumns = useMemo(() => resolveVisibleColumns(tableColumns, columnPrefs), [columnPrefs, tableColumns]);
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
      await generate({ deviceId, from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      setFeedback({ type: "success", message: "Relatório de rota criado com sucesso." });
    } catch (requestError) {
      const friendlyMessage = "Não foi possível gerar o relatório de rotas. Tente novamente mais tarde.";
      setFeedback({ type: "error", message: friendlyMessage });
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        {(loading || fetching || loadingPreferences) && <Loading message="Carregando rotas..." />}
        {error && <ErrorMessage error={error} fallback="Não foi possível carregar o relatório de rota." />}
        {formError && <ErrorMessage error={new Error(formError)} fallback={formError} />}
      </div>

      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Relatório de rota</h2>
          <p className="text-xs opacity-70">Extrai todos os pontos percorridos no intervalo informado.</p>
        </header>

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
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

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>
        )}
        {formError && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{formError}</div>
        )}
        {feedback && feedback.type === "success" && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
            {feedback.message}
          </div>
        )}
        {lastGeneratedAt && (
          <p className="text-xs text-white/60">Última geração: {formatDate(lastGeneratedAt)}</p>
        )}
      </section>

      {routeSummary && (
        <section className="card">
          <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Resumo da rota</h3>
              <p className="text-xs opacity-70">Dados atualizados conforme os pontos retornados pela API.</p>
            </div>
            <div className="text-xs text-white/60">
              {routeSummary.startTime && routeSummary.endTime
                ? `${formatDateTime(routeSummary.startTime, locale)} → ${formatDateTime(routeSummary.endTime, locale)}`
                : "Intervalo não informado"}
            </div>
          </header>

          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SummaryItem label="Veículo / dispositivo" value={routeSummary.deviceName} />
            <SummaryItem
              label="Distância total percorrida"
              value={routeSummary.totalDistanceKm !== null ? `${routeSummary.totalDistanceKm.toFixed(2)} km` : "—"}
            />
            <SummaryItem
              label="Duração total"
              value={routeSummary.durationMs !== null ? formatDuration(routeSummary.durationMs) : "—"}
            />
            <SummaryItem
              label="Velocidade média"
              value={routeSummary.averageSpeed !== null ? `${routeSummary.averageSpeed} km/h` : "—"}
            />
            <SummaryItem
              label="Velocidade máxima"
              value={routeSummary.maxSpeed !== null ? `${routeSummary.maxSpeed} km/h` : "—"}
            />
            {!routeSummary.movementUnavailable && (
              <SummaryItem label="Tempo parado / em movimento" value="—" />
            )}
          </dl>
        </section>
      )}

      <section className="card space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Pontos encontrados</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs opacity-60">{points.length} registros</span>
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
                  {tableColumns.map((column) => (
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
                    Processando rota…
                  </td>
                </tr>
              )}
              {!loading && !points.length && (
                <tr>
                  <td colSpan={visibleColumnCount} className="py-4 text-center text-sm opacity-60">
                    {lastGeneratedAt
                      ? "Nenhum registro encontrado para o período selecionado."
                      : "Gere um relatório para visualizar os pontos percorridos."}
                  </td>
                </tr>
              )}

              {points.map((point, index) => (
                <tr
                  key={`${point.deviceId ?? "unknown"}-${point.fixTime ?? point.serverTime ?? index}-${index}`}
                  className="hover:bg-white/5"
                >
                  {visibleColumns.map((column) => (
                    <td key={column.key} className="py-2 pr-6 text-white/80">
                      {column.render ? column.render(point) : column.getValue?.(point, { locale })}
                    </td>
                  ))}
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

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asLocalDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 16);
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

function pickNumber(values = []) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs)) return "—";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function computeDistanceKm(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  const startDistance = normaliseDistance(first);
  const endDistance = normaliseDistance(last);
  if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance)) return null;
  return Math.max(0, (endDistance - startDistance) / 1000);
}

function normaliseDistance(point) {
  const candidates = [point?.totalDistance, point?.distance, point?.attributes?.totalDistance, point?.attributes?.distance];
  for (const value of candidates) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function SummaryItem({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-white/60">{label}</dt>
      <dd className="mt-1 text-base font-semibold text-white">{value ?? "—"}</dd>
    </div>
  );
}
