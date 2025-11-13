import { useEffect, useMemo, useState } from "react";

/** Utils */
const d = (v) => (v ? new Date(v) : null);
const agoH = (h) => new Date(Date.now() - h * 3600_000);
const recent = (dt, h = 6) => dt && dt > agoH(h);

/** Normaliza device de várias origens */
function norm(raw) {
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
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        setLoading(true); setErr("");
        const r = await fetch("/api/core/devices", { credentials: "include" });
        if (!r.ok) throw new Error("devices " + r.status);
        const data = await r.json();
        const list = Array.isArray(data) ? data : data.items || data.devices || [];
        const normed = list.map(norm);
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

  const stats = useMemo(() => {
    const total = items.length;
    const ativos = items.filter(v => recent(v.last, 6)).length;
    const inativos = total - ativos;
    const bloqueados = items.filter(v => v.blocked).length;
    const conectados = items.filter(v => v.online).length;
    const withPos = items.filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lng)).length;
    return { total, ativos, inativos, bloqueados, conectados, withPos };
  }, [items]);

  return (
    <div className="px-6 py-5">
      <div className="text-xl font-semibold mb-1">Euro One</div>
      <div className="text-xs text-white/50 mb-4">Última sincronização: {new Date().toLocaleTimeString()}</div>

      {/* Linha dos 4 cards principais (estilo antigo) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
        <Kpi title="VEÍCULOS (TOTAL)" value={loading ? "—" : stats.total} />
        <Kpi title="ATIVOS" value={loading ? "—" : stats.ativos}
             sub={`${stats.total ? Math.round((stats.ativos/stats.total)*100) : 0}% câmeras OK`} />
        <Kpi title="INATIVOS" value={loading ? "—" : stats.inativos}
             sub={`${stats.inativos} sem fix >= 6h`} />
        <Kpi title="BLOQUEADOS" value={loading ? "—" : stats.bloqueados} />
      </div>

      {/* Linha de atalhos (mock leve, mantemos a estética) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ActionCard href="/monitoramento" title="Câmeras" sub="Euro View / ADAS / DSM" />
        <ActionCard href="/trajetos" title="Rotas / Trajetos" sub="Replays e desempenho" />
        <ActionCard href="/servicos" title="Serviços / Entregas" sub="OS, SLA e histórico" />
      </div>

      {/* Row: gráfico placeholder + status mapa resumo (lado direito) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl bg-[#12161f] border border-white/5 p-4">
          <div className="text-sm font-medium mb-3">ALERTAS NAS ÚLTIMAS 24H</div>
          {/* placeholder leve para não puxar chart libs agora */}
          <div className="text-white/40 text-sm">
            (Gráfico real entra depois — mantendo bundle leve por enquanto)
          </div>
        </div>

        <div className="rounded-2xl bg-[#12161f] border border-white/5 p-4">
          <div className="text-sm font-medium mb-3">STATUS NO MAPA (RESUMO)</div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Conectados</li>
            <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Inativos</li>
            <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Erro</li>
          </ul>
          <div className="mt-3 text-white/80 text-sm leading-5">
            Placeholder do mapa — o mapa real fica em <b>Monitoramento</b> para manter a Home leve.
          </div>

          <div className="mt-4 text-sm space-y-1">
            <div>Conectados: <b>{loading ? "—" : stats.conectados}</b></div>
            <div>Inativos: <b>{loading ? "—" : stats.inativos}</b></div>
            <div>Com posição: <b>{loading ? "—" : stats.withPos}</b></div>
          </div>
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 text-red-200 p-3 text-sm">
          Falha ao carregar devices: {err}
        </div>
      )}
    </div>
  );
}

/** Components */
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
