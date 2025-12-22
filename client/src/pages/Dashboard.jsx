import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AnimatePresence, motion } from "framer-motion";
import { Responsive, WidthProvider } from "react-grid-layout";
import { MoveRight, Sparkles } from "lucide-react";
import useDevices from "../lib/hooks/useDevices";
import { useEvents } from "../lib/hooks/useEvents";
import { useReports } from "../lib/hooks/useReports";
import Card from "../ui/Card";
import { Badge } from "../ui/shadcn/badge.jsx";
import { Button } from "../ui/shadcn/button.jsx";
import { translateEventType } from "../lib/event-translations.js";
import { useTranslation } from "../lib/i18n.js";
import Loading from "../components/Loading.jsx";
import ErrorMessage from "../components/ErrorMessage.jsx";
import { useTenant } from "../lib/tenant-context.jsx";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ResponsiveGridLayout = WidthProvider(Responsive);
const LAYOUT_STORAGE_KEY = "dashboard-grid-layout-v1";

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

function kmFromPosition(position) {
  const distance = position?.attributes?.totalDistance ?? position?.attributes?.distance ?? position?.distance;
  if (!distance) return 0;
  const meters = Number(distance);
  if (!Number.isFinite(meters)) return 0;
  return Math.max(meters / 1000, 0);
}

function speedFromPosition(position) {
  const speed = position?.attributes?.speed ?? position?.speed;
  if (!speed) return 0;
  const knots = Number(speed);
  if (!Number.isFinite(knots)) return 0;
  const kmh = knots > 180 ? knots : knots * 1.852;
  return Math.max(Math.round(kmh), 0);
}

function engineHours(position) {
  const hours = position?.attributes?.hours ?? position?.attributes?.engineHours;
  if (!hours) return 0;
  const value = Number(hours);
  if (!Number.isFinite(value)) return 0;
  return Math.round(value / 3600);
}

function pickDriver(event) {
  return (
    event?.attributes?.driverUniqueId ||
    event?.attributes?.driverName ||
    event?.driverUniqueId ||
    event?.driverId ||
    "motorista-desconhecido"
  );
}

function computeDriverRanking(events) {
  const ranking = new Map();
  events.forEach((event) => {
    const driver = pickDriver(event);
    const severity = event?.attributes?.alarm || event?.attributes?.type || event?.type;
    if (!ranking.has(driver)) {
      ranking.set(driver, { driver, infractions: 0, severe: 0 });
    }
    const entry = ranking.get(driver);
    entry.infractions += 1;
    if (severity && /harsh|crash|fatigue|seatbelt|sos|panic/i.test(String(severity))) {
      entry.severe += 2;
    } else if (severity && /speed|overspeed|brake|acceleration/i.test(String(severity))) {
      entry.severe += 1;
    }
  });
  return Array.from(ranking.values())
    .map((entry) => ({ ...entry, score: Math.max(100 - entry.infractions * 5 - entry.severe * 10, 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

const baseLayout = [
  { i: "stat-vehicles", x: 0, y: 0, w: 3, h: 2 },
  { i: "stat-distance", x: 3, y: 0, w: 3, h: 2 },
  { i: "stat-speed", x: 6, y: 0, w: 3, h: 2 },
  { i: "stat-engine", x: 9, y: 0, w: 3, h: 2 },
  { i: "chart-telemetry", x: 0, y: 2, w: 8, h: 6 },
  { i: "chart-events", x: 8, y: 2, w: 4, h: 6 },
  { i: "chart-ranking", x: 0, y: 8, w: 6, h: 6 },
  { i: "chart-fuel", x: 6, y: 8, w: 6, h: 6 },
  { i: "panel-quick-report", x: 0, y: 14, w: 12, h: 3 },
];

function clampLayout(cols) {
  return baseLayout.map((item) => {
    const width = Math.min(item.w, cols);
    return {
      ...item,
      w: width,
      x: Math.min(item.x, Math.max(cols - width, 0)),
    };
  });
}

const defaultLayouts = {
  lg: baseLayout,
  md: clampLayout(10),
  sm: clampLayout(8),
  xs: clampLayout(6),
  xxs: clampLayout(2),
};

function loadLayouts(storageKey) {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(storageKey || LAYOUT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn("Não foi possível restaurar o layout do dashboard", error);
    return null;
  }
}

function saveLayouts(storageKey, layouts) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey || LAYOUT_STORAGE_KEY, JSON.stringify(layouts));
  } catch (error) {
    console.warn("Não foi possível salvar o layout do dashboard", error);
  }
}

function cloneLayouts(layouts) {
  return JSON.parse(JSON.stringify(layouts));
}

export default function Dashboard() {
  const { locale, t } = useTranslation();
  const { devices, positionsByDeviceId, loading: loadingDevices } = useDevices({ withPositions: true });
  const { events, loading: loadingEvents } = useEvents({ limit: 200, refreshInterval: 60_000 });
  const { generateTripsReport, loading: generatingReport, error: reportError } = useReports();
  const { user, tenant } = useTenant();
  const layoutKey = useMemo(
    () => `${LAYOUT_STORAGE_KEY}-${tenant?.id ?? "global"}-${user?.id ?? "anon"}`,
    [tenant?.id, user?.id],
  );
  const [quickFeedback, setQuickFeedback] = useState(null);
  const [layouts, setLayouts] = useState(() => cloneLayouts(loadLayouts(layoutKey) || defaultLayouts));

  const positions = useMemo(() => positionsByDeviceId ?? {}, [positionsByDeviceId]);

  const monitoredVehiclesCount = useMemo(() => {
    const linkedVehicles = devices
      .map((device) => device.vehicleId ?? device.vehicle?.id ?? device.vehicle_id ?? null)
      .filter(Boolean);
    return new Set(linkedVehicles).size;
  }, [devices]);

  const summary = useMemo(() => {
    const list = toArray(positions);
    const totalDistance = list.reduce((acc, item) => acc + kmFromPosition(item), 0);
    const avgSpeed = list.reduce((acc, item) => acc + speedFromPosition(item), 0) / (list.length || 1);
    const engineTotal = list.reduce((acc, item) => acc + engineHours(item), 0);
    const ignitionOn = list.filter((item) => {
      const value = item?.attributes?.ignition ?? item?.ignition;
      return value === true || value === 1 || value === "1" || value === "true";
    }).length;
    const blocked = list.filter((item) => item?.attributes?.blocked || item?.blocked).length;
    const lowBattery = list.filter((item) => {
      const battery = Number(item?.attributes?.batteryLevel ?? item?.batteryLevel);
      return Number.isFinite(battery) && battery <= 20;
    }).length;

    const speedDistribution = list.map((item) => ({
      name: item.deviceId ?? item.id ?? "—",
      velocidade: speedFromPosition(item),
      distancia: kmFromPosition(item),
      motor: engineHours(item),
    }));

    const eventsByType = events.reduce((acc, event) => {
      const type = event.type ?? event.attributes?.type ?? "outros";
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});

    const drivers = computeDriverRanking(events);

    const fuelSeries = list
      .filter((item) => item?.attributes?.fuel || item?.attributes?.canFuelLevel)
      .map((item) => ({
        name: item.deviceId ?? item.id ?? "—",
        consumo: Number(item?.attributes?.fuel ?? item?.attributes?.canFuelLevel ?? 0),
        rpm: Number(item?.attributes?.rpm ?? item?.attributes?.canEngineRpm ?? 0),
      }));

    return {
      totalDistance,
      avgSpeed: Math.round(avgSpeed || 0),
      engineTotal,
      speedDistribution,
      eventsByType,
      drivers,
      fuelSeries,
      ignitionOn,
      blocked,
      lowBattery,
    };
  }, [positions, events]);

  const eventChartData = useMemo(
    () =>
      Object.entries(summary.eventsByType).map(([key, value]) => ({
        name: translateEventType(key, locale, t),
        value,
      })),
    [locale, summary.eventsByType, t],
  );

  const handleQuickReport = useCallback(async () => {
    if (!devices.length) {
      setQuickFeedback({ type: "error", message: "Nenhum veículo disponível para gerar o relatório." });
      return;
    }

    const first = devices[0];
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    setQuickFeedback(null);

    try {
      await generateTripsReport({ deviceId: first.id ?? first.deviceId, from: from.toISOString(), to: now.toISOString() });
      setQuickFeedback({ type: "success", message: "Relatório das últimas 24h gerado e salvo no histórico." });
    } catch (error) {
      setQuickFeedback({ type: "error", message: error?.message ?? "Não foi possível gerar o relatório." });
    }
  }, [devices, generateTripsReport]);

  const handleLayoutChange = (_current, updatedLayouts) => {
    const snapshot = cloneLayouts(updatedLayouts);
    setLayouts(snapshot);
    saveLayouts(layoutKey, snapshot);
  };

  const resetLayout = () => {
    const fallback = cloneLayouts(defaultLayouts);
    setLayouts(fallback);
    saveLayouts(layoutKey, fallback);
  };

  const refreshLayoutForProfile = useCallback(() => {
    const restored = cloneLayouts(loadLayouts(layoutKey) || defaultLayouts);
    setLayouts(restored);
  }, [layoutKey]);

  useEffect(() => {
    refreshLayoutForProfile();
  }, [refreshLayoutForProfile]);

  const gridItems = useMemo(
    () => [
      {
        key: "stat-vehicles",
        node: (
          <DashboardStat
            title="Veículos monitorados"
            value={loadingDevices ? "…" : monitoredVehiclesCount}
            hint="Conexões ativas com o Traccar"
          />
        ),
      },
      {
        key: "stat-distance",
        node: (
          <DashboardStat
            title="Ignição ligada"
            value={summary.ignitionOn ?? 0}
            hint="Veículos com motor em funcionamento agora"
          />
        ),
      },
      {
        key: "stat-speed",
        node: <DashboardStat title="Bloqueados" value={summary.blocked ?? 0} hint="Equipamentos com bloqueio ativo" />,
      },
      {
        key: "stat-engine",
        node: <DashboardStat title="Bateria baixa" value={summary.lowBattery ?? 0} hint="Nível abaixo de 20%" />,
      },
      {
        key: "chart-telemetry",
        node: (
          <Card
            title="Telemetria da frota"
            subtitle="Arraste para reposicionar ou ampliar o gráfico"
            contentClassName="h-full"
            headerClassName="drag-handle"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={summary.speedDistribution} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="name" stroke="rgba(148,163,184,0.7)" tick={{ fontSize: 12 }} />
                <YAxis stroke="rgba(148,163,184,0.7)" tick={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)" }} />
                <Legend />
                <Line type="monotone" dataKey="velocidade" stroke="#38bdf8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="distancia" stroke="#22c55e" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="motor" stroke="#f97316" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        ),
      },
      {
        key: "chart-events",
        node: (
          <Card
            title="Eventos por tipo"
            subtitle="Atualização contínua a cada minuto"
            contentClassName="h-full"
            headerClassName="drag-handle"
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={eventChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} fill="#6366f1" label />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)" }} />
              </PieChart>
            </ResponsiveContainer>
          </Card>
        ),
      },
      {
        key: "chart-ranking",
        node: (
          <Card title="Ranking de motoristas" subtitle="Pontuação baseada em eventos de condução" contentClassName="h-full" headerClassName="drag-handle">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.drivers} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="driver" stroke="rgba(148,163,184,0.7)" tick={{ fontSize: 12 }} />
                <YAxis stroke="rgba(148,163,184,0.7)" />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)" }} />
                <Legend />
                <Bar dataKey="score" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="infractions" fill="#ef4444" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        ),
      },
      {
        key: "chart-fuel",
        node: (
          <Card title="Consumo CAN" subtitle="Nível de combustível e rotações por minuto" contentClassName="h-full" headerClassName="drag-handle">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={summary.fuelSeries} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorFuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#facc15" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                <XAxis dataKey="name" stroke="rgba(148,163,184,0.7)" />
                <YAxis stroke="rgba(148,163,184,0.7)" />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)" }} />
                <Legend />
                <Area type="monotone" dataKey="consumo" stroke="#facc15" fillOpacity={1} fill="url(#colorFuel)" />
                <Line type="monotone" dataKey="rpm" stroke="#60a5fa" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        ),
      },
      {
        key: "panel-quick-report",
        node: (
          <Card
            title="Relatório rápido de viagens"
            subtitle="Salva no histórico e pode ser exportado em CSV"
            headerClassName="drag-handle"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <p className="text-sm opacity-80">Dispare rapidamente um relatório das últimas 24h do primeiro veículo listado.</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
                  <Badge variant="muted" className="glass-badge">
                    <span className="dot" /> Atualização ao vivo
                  </Badge>
                  <span className="flex items-center gap-2">Arraste qualquer cartão para reorganizar <MoveRight size={14} /></span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={resetLayout} className="border border-white/10">
                  Redefinir layout
                </Button>
                <Button onClick={handleQuickReport} disabled={generatingReport}>
                  {generatingReport ? "Gerando…" : "Gerar últimas 24h"}
                </Button>
              </div>
            </div>
            {reportError && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {reportError.message}
              </div>
            )}
            <AnimatePresence>
              {quickFeedback && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className={`mt-3 rounded-lg border p-3 text-sm ${
                    quickFeedback.type === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                      : "border-red-500/30 bg-red-500/10 text-red-200"
                  }`}
                >
                  {quickFeedback.message}
                </motion.div>
              )}
            </AnimatePresence>
          </Card>
        ),
      },
    ],
    [devices.length, generatingReport, handleQuickReport, loadingDevices, reportError, summary, quickFeedback],
  );

  return (
    <div className="space-y-6">
      <div className="dashboard-hero">
        <div className="dashboard-hero-content flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.2em] text-white/70">Dashboard dinâmico</p>
            <h1 className="text-2xl font-semibold text-white">Operação ao vivo</h1>
            <p className="text-sm text-white/70">
              Arraste, redimensione e salve sua visão. Preferências ficam atreladas ao seu perfil e tenant.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted" className="glass-badge">
              <Sparkles size={14} />
              Novo visual com animações suaves
            </Badge>
            <Badge variant="muted" className="glass-badge animate-pulse-soft">
              <span className="dot" /> Layout salvo
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {(loadingDevices || loadingEvents) && <Loading message="Atualizando dados da frota..." />}
        {reportError && <ErrorMessage error={reportError} fallback="Não foi possível gerar o relatório." />}
      </div>

      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1280, md: 1060, sm: 880, xs: 640, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 8, xs: 6, xxs: 2 }}
        rowHeight={82}
        margin={[16, 16]}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".drag-handle"
        resizeHandles={["se", "e", "s"]}
        compactType="vertical"
      >
        {gridItems.map((item) => (
          <motion.div
            key={item.key}
            className="h-full"
            layout
            transition={{ type: "spring", stiffness: 140, damping: 20 }}
            whileHover={{ scale: 1.01 }}
          >
            {item.node}
          </motion.div>
        ))}
      </ResponsiveGridLayout>

      {loadingEvents && <div className="text-xs opacity-60">Sincronizando eventos em tempo real…</div>}
    </div>
  );
}

function DashboardStat({ title, value, hint }) {
  return (
    <Card className="h-full" contentClassName="flex h-full flex-col justify-between gap-3" headerClassName="drag-handle">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wider opacity-70">{title}</div>
          <div className="text-3xl font-semibold">{value}</div>
        </div>
        <Badge variant="muted" className="glass-badge">
          <span className="dot" />
          Ao vivo
        </Badge>
      </div>
      {hint && <div className="text-xs opacity-70">{hint}</div>}
    </Card>
  );
}
