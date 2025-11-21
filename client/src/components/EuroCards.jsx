import { useEffect, useMemo, useState } from "react";
import { CoreApi } from "../lib/coreApi.js";

export default function EuroCards(){
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fixMap, setFixMap] = useState({}); // deviceId -> last position

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const devs = await CoreApi.listDevices();
        if (!live) return;
        setDevices(Array.isArray(devs) ? devs : []);
        // pega últimos fixes em paralelo (limite p/ 30 primeiros p/ não pesar)
        const pick = (Array.isArray(devs) ? devs : []).slice(0, 30);
        const entries = await Promise.all(pick.map(async d => [d.id, await CoreApi.lastPosition(d.id)]));
        if (!live) return;
        const map = {};
        for (const [id, p] of entries) map[id] = p;
        setFixMap(map);
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, []);

  const stats = useMemo(() => {
    const total = devices.length;
    let ativos = 0, semFix = 0;
    const threshold = Date.now() - 1000*60*60*6; // 6h
    for (const d of devices) {
      const p = fixMap[d.id];
      if (p && p.fixTime) {
        const t = new Date(p.fixTime).getTime();
        if (t >= threshold) ativos++;
        else semFix++;
      } else {
        semFix++;
      }
    }
    return { total, ativos, semFix };
  }, [devices, fixMap]);

  const Card = ({title, value, note}) => (
    <div className="rounded-2xl p-4 bg-white/5 border border-white/10 text-white">
      <div className="text-sm opacity-70">{title}</div>
      <div className="text-3xl font-semibold my-1">{loading ? "…" : value}</div>
      <div className="text-xs opacity-60">{note}</div>
    </div>
  );

  return (
    <div className="grid md:grid-cols-3 gap-3">
      <Card title="Dispositivos" value={stats.total} note="Total cadastrados" />
      <Card title="Com fix < 6h" value={stats.ativos} note="Atividade recente" />
      <Card title="Sem fix ≥ 6h" value={stats.semFix} note="Atenção" />
    </div>
  );
}
