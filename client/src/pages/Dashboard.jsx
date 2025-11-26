import React, { useCallback, useMemo, useState } from "react";
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
import useDevices from "../lib/hooks/useDevices";
import { useEvents } from "../lib/hooks/useEvents";
import { useReports } from "../lib/hooks/useReports";
import Card from "../ui/Card.jsx";
import { translateEventType } from "../lib/event-translations.js";
import { useTranslation } from "../lib/i18n.js";

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

export default function Dashboard() {
  const { locale, t } = useTranslation();
  const { devices, positionsByDeviceId, loading: loadingDevices } = useDevices({ withPositions: true });
  const { events, loading: loadingEvents } = useEvents({ limit: 200, refreshInterval: 60_000 });
  const { generateTripsReport, loading: generatingReport, error: reportError } = useReports();
  const [quickFeedback, setQuickFeedback] = useState(null);

  const positions = useMemo(() => positionsByDeviceId ?? {}, [positionsByDeviceId]);

  const summary = useMemo(() => {
    const list = toArray(positions);
    const totalDistance = list.reduce((acc, item) => acc + kmFromPosition(item), 0);
    const avgSpeed = list.reduce((acc, item) => acc + speedFromPosition(item), 0) / (list.length || 1);
    const engineTotal = list.reduce((acc, item) => acc + engineHours(item), 0);

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

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <DashboardStat title="Veículos monitorados" value={loadingDevices ? "…" : devices.length} />
        <DashboardStat
          title="Distância acumulada"
          value={`${summary.totalDistance.toFixed(1)} km`}
          hint="Somatório da métrica totalDistance reportada pelos rastreadores"
        />
        <DashboardStat title="Velocidade média" value={`${summary.avgSpeed} km/h`} />
        <DashboardStat title="Motor ligado" value={`${summary.engineTotal} h`} hint="Horas acumuladas de ignição" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Telemetria da frota"
          subtitle="Velocidade média, distância e horas de motor por veículo"
        >
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={summary.speedDistribution}>
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

        <Card title="Eventos por tipo" subtitle="Atualização contínua a cada minuto">
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={eventChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} fill="#6366f1" label />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(148,163,184,0.2)" }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Ranking de motoristas" subtitle="Pontuação baseada em eventos de condução">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={summary.drivers}>
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

          <Card title="Consumo CAN" subtitle="Nível de combustível e rotações por minuto">
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={summary.fuelSeries}>
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
        </section>

        <Card
          title="Relatório rápido de viagens"
          subtitle="Dispare um relatório de viagens diretamente do dashboard"
          actions={
            <button
              type="button"
              onClick={handleQuickReport}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow hover:bg-primary/90 disabled:opacity-60"
              disabled={generatingReport}
            >
              {generatingReport ? "Gerando…" : "Gerar últimas 24h"}
            </button>
          }
        >
          <p className="text-sm opacity-70">
            O relatório será salvo no histórico e pode ser exportado em CSV na página de relatórios.
          </p>
          {reportError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {reportError.message}
            </div>
          )}
          {quickFeedback && (
            <div
              className={`mt-3 rounded-lg border p-3 text-sm ${
                quickFeedback.type === "success"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                  : "border-red-500/30 bg-red-500/10 text-red-200"
              }`}
            >
              {quickFeedback.message}
            </div>
          )}
        </Card>

      {loadingEvents && <div className="text-xs opacity-60">Sincronizando eventos em tempo real…</div>}
    </div>
  );
}

function DashboardStat({ title, value, hint }) {
  return (
    <Card className="space-y-2">
      <div className="text-xs uppercase tracking-wider opacity-60">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs opacity-60">{hint}</div>}
    </Card>
  );
}
