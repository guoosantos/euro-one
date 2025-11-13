import React, { useEffect, useMemo, useState } from "react";

function getFixDate(d) {
  const posTime = d?.position?.fixTime || d?.lastFix || d?.lastCommunication;
  const last = posTime || d?.lastUpdate || d?.statusTime;
  const dt = last ? new Date(last) : null;
  return isNaN(dt?.getTime?.()) ? null : dt;
}

const RANGES = [
  { key: "0_1h",    label: "0–1h",        minH: 0,   maxH: 1,    color: "#63B365" },
  { key: "1_6h",    label: "1–6h",        minH: 1,   maxH: 6,    color: "#E0B43C" },
  { key: "6_12h",   label: "6–12h",       minH: 6,   maxH: 12,   color: "#E0B43C" },
  { key: "12_24h",  label: "12–24h",      minH: 12,  maxH: 24,   color: "#E1973E" },
  { key: "24_72h",  label: "24–72h",      minH: 24,  maxH: 72,   color: "#DB6C3B" },
  { key: "72h_10d", label: "72h–10 dias", minH: 72,  maxH: 240,  color: "#D65A37" },
  { key: "10_30d",  label: "10–30 dias",  minH: 240, maxH: 720,  color: "#C95333" },
  { key: "30d",     label: "30 dias+",    minH: 720, maxH: Infinity, color: "#C1482D" },
];

function bucketOf(hours) {
  for (const r of RANGES) if (hours >= r.minH && hours < r.maxH) return r.key;
  return RANGES[RANGES.length - 1].key;
}

export default function CommBuckets() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/core/devices", { credentials: "include" });
        const data = await r.json();
        if (!alive) return;
        setItems(Array.isArray(data) ? data : (data?.items || []));
      } catch (e) {
        console.error("CommBuckets fetch error", e);
        setItems([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const now = useMemo(() => new Date(), []);
  const grouped = useMemo(() => {
    const g = {}; RANGES.forEach(r => g[r.key] = []);
    for (const d of items) {
      const dt = getFixDate(d);
      const h = dt ? (now - dt) / 36e5 : Infinity;
      const key = bucketOf(h);
      g[key].push({
        id: d.id,
        name: d.name || d.uniqueId || `#${d.id}`,
        plate: d.plate || d.vehiclePlate || d?.attributes?.plate || "",
        last: dt || null
      });
    }
    for (const k of Object.keys(g)) {
      g[k].sort((a,b)=> (b.last?.getTime?.()||0) - (a.last?.getTime?.()||0));
    }
    return g;
  }, [items, now]);

  const total = items.length || 1;

  return (
    <div className="bg-[#0f141d] border border-white/5 rounded-2xl p-4 mb-6">
      <div className="text-lg font-semibold mb-2">Status de comunicação</div>
      {loading ? <div className="text-white/60 text-sm">Carregando…</div> : (
        <div className="space-y-3">
          {RANGES.map(r => {
            const list = grouped[r.key] || [];
            const pct = Math.round((list.length / total) * 100);
            const open = expanded === r.key;
            return (
              <div key={r.key} className="rounded-xl">
                <button onClick={()=>setExpanded(open?null:r.key)} className="w-full flex items-center justify-between gap-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="inline-block w-4 h-4 rounded" style={{background:r.color}} />
                    <div className="text-sm">
                      <div className="font-medium">{r.label}</div>
                      <div className="text-white/50">{list.length} veículo(s)</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-white/70 text-sm">{pct}%</div>
                    <svg className={`w-4 h-4 transition-transform ${open?"rotate-180":""}`} viewBox="0 0 20 20" fill="currentColor">
                      <path d="M5.5 7l4.5 4.5L14.5 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                    </svg>
                  </div>
                </button>
                <div className="h-2 rounded bg-white/10 overflow-hidden">
                  <div className="h-full" style={{width:`${pct}%`,background:r.color}}></div>
                </div>
                {open && (
                  <div className="mt-3 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="text-sm text-white/70">{list.length} veículo(s) em {r.label}</div>
                      <input value={q} onChange={e=>setQ(e.target.value)}
                        placeholder="Buscar veículo/placa…" className="bg-[#0b0f17] border border-white/10 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-white/20"/>
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg">
                      <table className="w-full text-sm">
                        <thead className="text-white/50">
                          <tr><th className="text-left font-normal py-1.5 px-2">Veículo</th>
                              <th className="text-left font-normal py-1.5 px-2">Placa</th>
                              <th className="text-left font-normal py-1.5 px-2">Última comunicação</th></tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {list.filter(v=>{
                              const s=q.trim().toLowerCase(); if(!s) return true;
                              return (v.name||"").toLowerCase().includes(s) || (v.plate||"").toLowerCase().includes(s);
                            }).map(v=>(
                            <tr key={v.id} className="hover:bg-white/5">
                              <td className="py-1.5 px-2">{v.name}</td>
                              <td className="py-1.5 px-2">{v.plate || "—"}</td>
                              <td className="py-1.5 px-2">{v.last ? v.last.toLocaleString() : "sem registro"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
