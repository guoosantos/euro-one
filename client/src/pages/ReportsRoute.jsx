import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import useVehicles, { normalizeVehicleDevices } from "../lib/hooks/useVehicles.js";
import useReportsRoute from "../lib/hooks/useReportsRoute";
import { useTranslation } from "../lib/i18n.js";
import AddressCell from "../ui/AddressCell.jsx";
import { formatDateTime, pickCoordinate, pickSpeed } from "../lib/monitoring-helpers.js";
import useUserPreferences from "../lib/hooks/useUserPreferences.js";
import { toDeviceKey } from "../lib/hooks/useDevices.helpers.js";
import VehicleSelector from "../components/VehicleSelector.jsx";
import useVehicleSelection from "../lib/hooks/useVehicleSelection.js";
import {
  loadColumnPreferences,
  mergeColumnPreferences,
  reorderColumns,
  resolveVisibleColumns,
  saveColumnPreferences,
} from "../lib/column-preferences.js";
import { buildColumnPreset, EURO_PRESET_KEYS } from "../lib/report-column-presets.js";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import {
  buildAddressWithLatLng,
  resolveReportColumnLabel,
  resolveReportColumnTooltip,
} from "../lib/report-column-labels.js";
import { getSeverityBadgeClassName, resolveSeverityLabel } from "../lib/severity-badge.js";

  const COLUMN_STORAGE_KEY = "routeReportColumns";

export default function ReportsRoute() {
  const { locale } = useTranslation();
  const location = useLocation();
  const {
    vehicles,
    vehicleOptions,
    loading: loadingVehicles,
    error: vehiclesError,
  } = useVehicles();
  const {
    selectedVehicleId: vehicleId,
    selectedTelemetryDeviceId: deviceIdFromStore,
    selectedVehicle,
    setVehicleSelection,
  } = useVehicleSelection({ syncQuery: true });
  const { data, loading, error, generate } = useReportsRoute();
  const { preferences, loading: loadingPreferences, savePreferences } = useUserPreferences();

  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [fetching, setFetching] = useState(false);
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const [draggingColumn, setDraggingColumn] = useState(null);

  const points = Array.isArray(data?.positions) ? data.positions : Array.isArray(data) ? data : [];
  const lastGeneratedAt = data?.__meta?.generatedAt;
  const deviceId = deviceIdFromStore || selectedVehicle?.primaryDeviceId || "";
  const deviceUnavailable = Boolean(vehicleId) && !deviceId;
  const vehicleByDeviceId = useMemo(() => {
    const map = new Map();
    vehicles.forEach((vehicle) => {
      normalizeVehicleDevices(vehicle).forEach((device) => {
        const key = toDeviceKey(device?.id ?? device?.deviceId ?? device?.uniqueId ?? device?.traccarId);
        if (key) map.set(String(key), vehicle);
      });
    });
    return map;
  }, [vehicles]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");

    const parsedFrom = asLocalDateTime(queryFrom);
    if (parsedFrom && parsedFrom !== from) {
      setFrom(parsedFrom);
    }
    const parsedTo = asLocalDateTime(queryTo);
    if (parsedTo && parsedTo !== to) {
      setTo(parsedTo);
    }
  }, [from, location.search, to]);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const queryFrom = search.get("from");
    const queryTo = search.get("to");
    if (!queryFrom || !queryTo || fetching) return;
    const intendedFrom = parseDate(queryFrom);
    const intendedTo = parseDate(queryTo);
    if (!intendedFrom || !intendedTo) return;
    if (!deviceId) return;

    const params = {
      deviceId,
      vehicleId: vehicleId || vehicleByDeviceId.get(String(deviceId))?.id,
      from: intendedFrom.toISOString(),
      to: intendedTo.toISOString(),
    };
    const currentParams = data?.__meta?.params || {};
    const alreadyLoaded =
      currentParams.deviceId === params.deviceId &&
      currentParams.from === params.from &&
      currentParams.to === params.to;

    if (!alreadyLoaded && !loading) {
      setFetching(true);
      generate(params)
        .catch(() => {
          // falha silenciosa ao tentar pré-carregar a partir do link de viagens.
        })
        .finally(() => setFetching(false));
    }
  }, [data?.__meta?.params, deviceId, fetching, generate, loading, location.search, vehicleByDeviceId, vehicleId]);

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
        summary.deviceName ||
        selectedVehicle?.plate ||
        selectedVehicle?.name ||
        params.vehicleId ||
        params.deviceId ||
        "—",
      startTime,
      endTime,
      durationMs,
      totalDistanceKm,
      averageSpeed,
      maxSpeed,
      // Tempo parado/em movimento dependem do backend devolver esses campos ou um resumo dedicado.
      movementUnavailable: true,
    };
  }, [data, points, selectedVehicle]);

  const tableColumns = useMemo(
    () => [
      {
        key: "gpsTime",
        label: resolveReportColumnLabel("gpsTime", "Hora GPS"),
        fullLabel: resolveReportColumnTooltip("gpsTime", "Hora GPS"),
        defaultVisible: true,
        render: (point) => formatDateTime(parseDate(point.fixTime ?? point.deviceTime ?? point.serverTime), locale),
      },
      {
        key: "latitude",
        label: resolveReportColumnLabel("latitude", "Latitude"),
        fullLabel: resolveReportColumnTooltip("latitude", "Latitude"),
        defaultVisible: false,
        render: (point) => {
          const value = pickCoordinate([point.latitude, point.lat, point.lat_deg, point.attributes?.latitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "longitude",
        label: resolveReportColumnLabel("longitude", "Longitude"),
        fullLabel: resolveReportColumnTooltip("longitude", "Longitude"),
        defaultVisible: false,
        render: (point) => {
          const value = pickCoordinate([point.longitude, point.lon, point.lng, point.attributes?.longitude]);
          return Number.isFinite(value) ? value.toFixed(5) : "—";
        },
      },
      {
        key: "speed",
        label: resolveReportColumnLabel("speed", "Velocidade (km/h)"),
        fullLabel: resolveReportColumnTooltip("speed", "Velocidade (km/h)"),
        defaultVisible: true,
        render: (point) => {
          const speed = pickSpeed(point);
          return speed !== null ? `${speed} km/h` : "—";
        },
      },
      {
        key: "event",
        label: resolveReportColumnLabel("event", "Evento"),
        fullLabel: resolveReportColumnTooltip("event", "Evento"),
        defaultVisible: true,
        render: (point) => point.event || point.attributes?.event || point.type || "—",
      },
      {
        key: "address",
        label: resolveReportColumnLabel("address", "Endereço"),
        fullLabel: resolveReportColumnTooltip("address", "Endereço"),
        defaultVisible: true,
        render: (point) => {
          const lat = pickCoordinate([point.latitude, point.lat, point.attributes?.latitude]);
          const lng = pickCoordinate([point.longitude, point.lon, point.lng, point.attributes?.longitude]);
          const text = buildAddressWithLatLng(point.address || point.attributes?.address, lat, lng);
          return <AddressCell address={text} />;
        },
      },
      {
        key: "criticality",
        label: resolveReportColumnLabel("criticality", "Severidade"),
        fullLabel: resolveReportColumnTooltip("criticality", "Severidade"),
        defaultVisible: false,
        render: (point) => {
          const severity = point?.attributes?.severity || point?.severity;
          if (!severity) return "—";
          const label = String(severity);
          const display = resolveSeverityLabel(label);
          return (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${getSeverityBadgeClassName(label)}`}
            >
              {display}
            </span>
          );
        },
      },
      {
        key: "geofence",
        label: resolveReportColumnLabel("geofence", "Geozona"),
        fullLabel: resolveReportColumnTooltip("geofence", "Geozona"),
        defaultVisible: false,
        render: (point) => point.geofence || point.attributes?.geofence || "—",
      },
      {
        key: "ioSummary",
        label: resolveReportColumnLabel("ioSummary", "Entradas/Saídas"),
        fullLabel: resolveReportColumnTooltip("ioSummary", "Entradas/Saídas"),
        defaultVisible: false,
        render: (point) =>
          point.attributes?.ioDetails?.map?.((item) => `${item.label || item.key}: ${item.value ?? "—"}`).join(" • ") || "—",
      },
      {
        key: "ignition",
        label: resolveReportColumnLabel("ignition", "Ignição"),
        fullLabel: resolveReportColumnTooltip("ignition", "Ignição"),
        defaultVisible: false,
        render: (point) => point.attributes?.ignition ?? point.ignition ?? "—",
      },
      {
        key: "vehicleVoltage",
        label: resolveReportColumnLabel("vehicleVoltage", "Tensão"),
        fullLabel: resolveReportColumnTooltip("vehicleVoltage", "Tensão"),
        defaultVisible: false,
        render: (point) => point.attributes?.vehicleVoltage ?? point.attributes?.power ?? point.vehicleVoltage ?? "—",
      },
    ],
    [locale],
  );

  const defaultPreferences = useMemo(
    () => buildColumnPreset(tableColumns, EURO_PRESET_KEYS),
    [tableColumns],
  );
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
  const orderedColumns = useMemo(() => {
    const order = columnPrefs?.order || [];
    const ordered = order
      .map((key) => tableColumns.find((column) => column.key === key))
      .filter(Boolean);
    const missing = tableColumns.filter((column) => !order.includes(column.key));
    return [...ordered, ...missing];
  }, [columnPrefs?.order, tableColumns]);
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
      await generate({
        deviceId,
        vehicleId: vehicleId || vehicleByDeviceId.get(String(deviceId))?.id,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
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
      <PageHeader
        overline="Central de relatórios"
        title="Relatório de rota"
        subtitle="Extrai todos os pontos percorridos no intervalo informado."
      />
      <div className="flex flex-col gap-2">
        {(loading || fetching || loadingPreferences) && <Loading message="Carregando rotas..." />}
        {error && <ErrorMessage error={error} fallback="Não foi possível carregar o relatório de rota." />}
        {formError && <ErrorMessage error={new Error(formError)} fallback={formError} />}
      </div>

      <section className="card space-y-4">
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-4">
          <VehicleSelector className="text-sm md:col-span-2" />

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

        {deviceUnavailable && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-100">
            Selecione um veículo com equipamento vinculado para gerar o relatório.
          </div>
        )}

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
            <SummaryItem label="Veículo" value={routeSummary.deviceName} />
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
                  {orderedColumns.map((column) => (
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
                    Padrão Euro
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
                  <th key={column.key} className="py-2 pr-6" title={column.fullLabel || column.label}>
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
  if (!deviceId) return "Selecione um veículo com equipamento vinculado para gerar o relatório.";
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
