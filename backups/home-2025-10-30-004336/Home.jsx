import { useEffect, useMemo, useState } from "react";

const parseDate = (v) => (v ? new Date(v) : null);
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000);
const isRecent = (d, h = 6) => d && d > hoursAgo(h);

// Normaliza device com fallbacks pra não quebrar a UI
function normalizeDevice(raw) {
  const pos = raw?.position || raw?.lastPosition || null;
  const last =
    parseDate(raw?.lastFix) ||
    parseDate(raw?.lastSeen) ||
    parseDate(raw?.lastUpdate) ||
    (pos && parseDate(pos.fixTime)) ||
    null;

  const status =
    typeof raw?.online === "boolean"
      ? raw.online
      : raw?.status
      ? String(raw.status).toLowerCase() === "online"
      : isRecent(last, 1); // fallback: consideramos online se teve fix <1h

  return {
    id: raw.id ?? raw.deviceId ?? raw.uniqueId ?? String(Math.random()),
    name: raw.name ?? raw.label ?? raw.uniqueId ?? "Sem nome",
    model: raw.model ?? raw.type ?? "-",
    last,
    blocked: !!raw.blocked,
    lat: pos?.latitude ?? pos?.lat ?? null,
    lng: pos?.longitude ?? pos?.lng ?? null,
    status,
  };
}

export default function Home() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        setLoading(true);
        setErr("");
        const r = await fetch("/api/core/devices", { credentials: "include" });
        if (!r.ok) throw new Error(`devices ${r.status}`);
        const data = await r.json();
        const list = Array.isArray(data) ? data : data.items || data.devices || [];
        const norm = list.map(normalizeDevice);
        if (alive) setDevices(norm);
      } catch (e) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 30_000); // atualiza a cada 30s
    return () => { alive = false; clearInterval(t); };
  }, []);

  const stats = useMemo(() => {
    const total = devices.length;
    const ativos = devices.filter((d) => isRecent(d.last, 6)).length;
    const inativos = total - ativos;
    const bloqueados = devices.filter((d) => d.blocked).length;
    const withPos = devices.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng));
    const conectados = devices.filter((d) => d.status).length;
    return { total, ativos, inativos, bloqueados, conectados, withPos };
  }, [devices]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Euro One — Visão Geral</h1>

      {/* Linha 1 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DashCard title="Veículos (TOTAL)" value={stats.total} subtitle="Total cadastrados" loading={loading} />
        <DashCard title="Com fix < 6h" value={stats.ativos} subtitle="Atividade recente" loading={loading} />
        <DashCard title="Sem fix ≥ 6h" value={stats.inativos} subtitle="Atenção" loading={loading} />
      </div>

      {/* Linha 2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <a href="/monitoramento" className="block">
          <DashCard
            title="Mapa de Monitoramento"
            value={`${stats.conectados} conectados`}
            subtitle={`${stats.withPos.length} com posição`}
            loading={loading}
          />
        </a>
        <a href="/equipamentos" className="block">
          <DashCard title="Equipamentos" value={stats.total} subtitle="Gerenciar vínculos" loading={loading} />
        </a>
        {stats.bloqueados > 0 && (
          <DashCard title="Bloqueados" value={stats.bloqueados} subtitle="Imobilização ativa" loading={loading} />
        )}
      </div>

      {/* Placeholder leve do mapa (sem dependência externa) */}
      {stats.withPos.length > 0 && (
        <div className="rounded-2xl border border-white/5 bg-[#0f141c] p-4">
          <div className="text-sm text-white/60 mb-1">Status no mapa (resumo)</div>
          <div className="text-white/70 text-sm">
            Conectados: {stats.conectados} • Com posição: {stats.withPos.length}
          </div>
          <div className="text-white/40 text-xs mt-1">
            (Mapa interativo fica na página Monitoramento para manter a Home leve)
          </div>
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 p-3 text-sm">
          Falha ao carregar devices: {err}
        </div>
      )}
    </div>
  );
}

function DashCard({ title, value, subtitle, loading }) {
  return (
    <div className="rounded-2xl bg-[#12161f] p-4 shadow-sm border border-white/5">
      <div className="text-sm text-white/60">{title}</div>
      <div className="text-3xl font-semibold mt-1">{loading ? "—" : value}</div>
      {subtitle && <div className="text-xs text-white/40 mt-1">{subtitle}</div>}
    </div>
  );
}
