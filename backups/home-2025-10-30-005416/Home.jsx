import { useEffect, useMemo, useState } from "react";

// Tenta usar a Sidebar original do projeto; se não existir, ignora sem quebrar a Home
let Sidebar = null;
try { Sidebar = require("../components/Sidebar").Sidebar || require("../components/Sidebar").default || null; } catch {}

// ==== helpers ====
const d = (v) => (v ? new Date(v) : null);
const agoH = (h) => new Date(Date.now() - h * 3600_000);
const recent = (dt, h = 6) => dt && dt > agoH(h);
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Normaliza devices de origens diferentes
function normDevice(raw) {
  const pos = raw?.position || raw?.lastPosition || null;
  const last =
    d(raw?.lastFix) ||
    d(raw?.lastSeen) ||
    d(raw?.lastUpdate) ||
    (pos && d(pos.fixTime)) ||
    null;

  const online =
    typeof raw?.online === "boolean"
      ? raw.online
      : raw?.status
      ? String(raw.status).toLowerCase() === "online"
      : recent(last, 1);

  return {
    id: raw.id ?? raw.deviceId ?? raw.uniqueId ?? Math.random().toString(36).slice(2),
    name: raw.name ?? raw.uniqueId ?? "Sem nome",
    model: raw.model ?? raw.type ?? "-",
    last,
    blocked: !!raw.blocked,
    lat: pos?.latitude ?? pos?.lat ?? null,
    lng: pos?.longitude ?? pos?.lng ?? null,
    online,
  };
}

export default function Home() {
  const [items, setItems] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Devices
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true); setErr("");
        const r = await fetch("/api/core/devices", { credentials: "include" });
        if (!r.ok) throw new Error("devices " + r.status);
        const data = await r.json();
        const list = Array.isArray(data) ? data : data.items || data.devices || [];
        const normed = list.map(normDevice);
        if (alive) setItems(normed);
      } catch (e) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Events (se o endpoint não existir, faço fallback)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/core/events?from=-24h", { credentials: "include" });
        if (!r.ok) throw new Error("events " + r.status);
        const data = await r.json();
        const list = Array.isArray(data) ? data : data.items || data.events || [];
        if (alive) setEvents(list.slice(0, 8));
      } catch {
        // fallback: sintetiza eventos a partir de devices fora/online
        if (alive) {
          const synth = items.slice(0, 8).map((d, i) => ({
            id: d.id + ":" + i,
            time: (d.last || new Date()).toISOString(),
            deviceName: d.name,
            type: d.online ? "status.online" : "status.offline",
            severity: d.online ? "low" : "high",
          }));
          setEvents(synth);
        }
      }
    })();
    return () => { alive = false; };
  }, [items]);

  const stats = useMemo(() => {
    const total = items.length;
    const ativos = items.filter(v => recent(v.last, 6)).length;
    const inativos = total - ativos;
    const bloqueados = items.filter(v => v.blocked).length;
    const conectados = items.filter(v => v.online).length;
    const withPos = items.filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng)).length;

    // distribui horária sintética p/ gráfico (até termos endpoint real)
    const hours = Array.from({ length: 24 }, (_, k) => k);
    const series = hours.map(h => {
      const bucket = items.filter(v => {
        const L = v.last;
        return L && L.getHours() === h && recent(L, 24);
      }).length;
      return bucket;
    });

    return { total, ativos, inativos, bloqueados, conectados, withPos, hours, series };
  }, [items]);

  return (
    <div className="min-h-screen bg-[#0c111a] text-white flex">
      {/* Sidebar (se existir) */}
      {Sidebar ? (
        <aside className="w-[240px] hidden md:block border-r border-white/5">
          <Sidebar />
        </aside>
      ) : null}

      <main className="flex-1 px-6 py-5">
        <header className="mb-2">
          <div className="text-xl font-semibold">Euro One</div>
          <div className="text-xs text-white/50">Última sincronização: {new Date().toLocaleTimeString()}</div>
        </header>

        {/* KPIs topo */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <Kpi title="VEÍCULOS (TOTAL)" value={loading ? "—" : stats.total} />
          <Kpi title="ATIVOS" value={loading ? "—" : stats.ativos} sub={`${pct(stats.ativos, stats.total)}% câmeras OK`} />
          <Kpi title="INATIVOS" value={loading ? "—" : stats.inativos} sub={`${stats.inativos} sem fix >= 6h`} />
          <Kpi title="BLOQUEADOS" value={loading ? "—" : stats.bloqueados} />
        </div>

        {/* Atalhos (inclui Euro View) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <ActionCard href="/monitoramento" title="Câmeras (Euro View)" sub="Eventos, vídeos e Live" />
          <ActionCard href="/trajetos" title="Rotas / Trajetos" sub="Replays e desempenho" />
          <ActionCard href="/servicos" title="Serviços / Entregas" sub="OS, SLA e histórico" />
        </div>

        {/* Linha: Gráfico + Status no mapa */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="lg:col-span-2 rounded-2xl bg-[#12161f] border border-white/5 p-4">
            <div className="text-sm font-medium mb-3">ALERTAS NAS ÚLTIMAS 24H</div>
            <MiniBars hours={stats.hours} data={stats.series} />
          </div>

          <div className="rounded-2xl bg-[#12161f] border border-white/5 p-4">
            <div className="text-sm font-medium mb-3">STATUS NO MAPA (RESUMO)</div>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Conectados</li>
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Inativos</li>
              <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Erro</li>
            </ul>
            <div className="mt-3 text-sm space-y-1">
              <div>Conectados: <b>{loading ? "—" : stats.conectados}</b></div>
              <div>Inativos: <b>{loading ? "—" : stats.inativos}</b></div>
              <div>Com posição: <b>{loading ? "—" : stats.withPos}</b></div>
            </div>

            {/* Abas simples */}
            <div className="mt-4 flex gap-2">
              <a className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm" href="/monitoramento">No mapa</a>
              <a className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm" href="/trajetos">Replay</a>
            </div>
          </div>
        </div>

        {/* Últimos eventos importantes */}
        <section className="rounded-2xl bg-[#12161f] border border-white/5 p-4">
          <div className="text-sm font-medium mb-3">ÚLTIMOS EVENTOS IMPORTANTES</div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-white/60">
                <tr className="[&>th]:text-left [&>th]:py-2 border-b border-white/10">
                  <th>DATA/HORA</th><th>EVENTO</th><th>VEÍCULO</th><th>SEVERIDADE</th><th>AÇÕES</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-white/40">Sem eventos nas últimas 24h.</td></tr>
                ) : events.map((e) => (
                  <tr key={e.id || e.time} className="[&>td]:py-2 border-b border-white/5">
                    <td>{fmt(e.time)}</td>
                    <td>{e.type || e.event || "evento"}</td>
                    <td>{e.deviceName || e.device || "-"}</td>
                    <td><SeverityBadge level={sev(e.severity || e.level || e.type)} /></td>
                    <td className="space-x-2">
                      <a className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20" href="/monitoramento">No mapa</a>
                      <a className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20" href="/trajetos">Replay</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {err && (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 p-3 text-sm">
            Falha ao carregar devices: {err}
          </div>
        )}
      </main>
    </div>
  );
}

// ===== components locais =====
function Kpi({ title, value, sub }) {
  return (
    <div className="rounded-2xl bg-[#12161f] border border-white/5 p-4">
      <div className="text-xs text-white/60">{title}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-white/40 mt-1">{sub}</div>}
    </div>
  );
}

function ActionCard({ href, title, sub }) {
  return (
    <a href={href} className="block rounded-2xl bg-[#12161f] border border-white/5 p-4 hover:border-white/20 transition">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-white/50 mt-1">{sub}</div>
    </a>
  );
}

function MiniBars({ hours, data }) {
  const max = Math.max(1, ...data);
  const H = 120, W = 24 * 18, barW = 12, gap = 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[150px]">
      {data.map((v, i) => {
        const h = Math.round((v / max) * (H - 20));
        const x = i * (barW + gap);
        return <rect key={i} x={x} y={H - h} width={barW} height={h} rx="3" className="fill-white/40" />;
      })}
    </svg>
  );
}

function SeverityBadge({ level }) {
  const map = {
    high: "bg-red-500/20 text-red-200 border-red-500/40",
    med: "bg-yellow-500/20 text-yellow-200 border-yellow-500/40",
    low: "bg-green-500/20 text-green-200 border-green-500/40",
  };
  const cls = map[level] || "bg-white/10 text-white/70 border-white/20";
  const label = level === "high" ? "Alta" : level === "med" ? "Média" : level === "low" ? "Baixa" : "—";
  return <span className={`px-2 py-1 rounded border text-xs ${cls}`}>{label}</span>;
}

function fmt(t) {
  try { return new Date(t).toLocaleString(); } catch { return String(t).slice(0,19).replace("T"," "); }
}
function sev(s) {
  const k = String(s || "").toLowerCase();
  if (k.includes("alarm") || k.includes("panic") || k.includes("offline")) return "high";
  if (k.includes("warn") || k.includes("geofence")) return "med";
  if (k.includes("online")) return "low";
  return "med";
}
