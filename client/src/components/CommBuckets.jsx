import React, { useEffect, useMemo, useState } from "react";

import { CoreApi } from "../lib/coreApi.js";

const RANGES = [
  { key: "0_1h", label: "0–1h", minH: 0, maxH: 1, color: "#63B365" },
  { key: "1_6h", label: "1–6h", minH: 1, maxH: 6, color: "#E0B43C" },
  { key: "6_12h", label: "6–12h", minH: 6, maxH: 12, color: "#E0B43C" },
  { key: "12_24h", label: "12–24h", minH: 12, maxH: 24, color: "#E1973E" },
  { key: "24_72h", label: "24–72h", minH: 24, maxH: 72, color: "#DB6C3B" },
  { key: "72h_10d", label: "72h–10 dias", minH: 72, maxH: 240, color: "#D65A37" },
  { key: "10_30d", label: "10–30 dias", minH: 240, maxH: 720, color: "#C95333" },
  { key: "30d", label: "30 dias+", minH: 720, maxH: Infinity, color: "#C1482D" },
];

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bucketOf(hours) {
  for (const range of RANGES) {
    if (hours >= range.minH && hours < range.maxH) return range.key;
  }
  return RANGES[RANGES.length - 1].key;
}

export default function CommBuckets() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const list = await CoreApi.listDevices();
        if (active) {
          setDevices(Array.isArray(list) ? list : []);
        }
      } catch (_error) {
        if (active) {
          setDevices([]);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const groups = {};
    RANGES.forEach((range) => {
      groups[range.key] = [];
    });
    const now = new Date();
    devices.forEach((device) => {
      const last = parseDate(device.lastCommunication);
      const hours = last ? (now - last) / 36e5 : Infinity;
      const key = bucketOf(hours);
      groups[key].push({
        id: device.internalId || device.id || device.uniqueId,
        name: device.name || device.uniqueId || "Dispositivo",
        plate: device.vehicle?.plate || device.vehicle?.name || "",
        last,
      });
    });
    Object.keys(groups).forEach((key) => {
      groups[key].sort((a, b) => (b.last?.getTime?.() || 0) - (a.last?.getTime?.() || 0));
    });
    return groups;
  }, [devices]);

  const total = devices.length || 1;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-lg font-semibold text-white">Status de comunicação</div>
      {loading ? (
        <div className="mt-3 text-sm text-white/60">Carregando…</div>
      ) : (
        <div className="mt-3 space-y-3">
          {RANGES.map((range) => {
            const list = grouped[range.key] || [];
            const percentage = Math.round((list.length / total) * 100);
            const filtered = list.filter((item) => {
              if (!query.trim()) return true;
              const term = query.trim().toLowerCase();
              return (
                item.name.toLowerCase().includes(term) ||
                (item.plate || "").toLowerCase().includes(term)
              );
            });
            return (
              <section key={range.key} className="rounded-xl border border-white/5 bg-white/5 p-3">
                <header className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-block h-4 w-4 rounded" style={{ background: range.color }} />
                    <div>
                      <div className="text-sm font-medium text-white">{range.label}</div>
                      <div className="text-xs text-white/60">{list.length} veículo(s)</div>
                    </div>
                  </div>
                  <div className="text-sm text-white/70">{percentage}%</div>
                </header>
                <div className="mt-2 h-2 w-full overflow-hidden rounded bg-white/10">
                  <div className="h-full" style={{ width: `${percentage}%`, background: range.color }} />
                </div>
                {filtered.length > 0 && (
                  <div className="mt-3">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar veículo/placa…"
                      className="mb-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    />
                    <div className="max-h-64 overflow-auto rounded-lg border border-white/10">
                      <table className="min-w-full text-sm">
                        <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/60">
                          <tr>
                            <th className="px-3 py-2 text-left">Veículo</th>
                            <th className="px-3 py-2 text-left">Placa</th>
                            <th className="px-3 py-2 text-left">Última comunicação</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {filtered.map((item) => (
                            <tr key={item.id} className="hover:bg-white/5">
                              <td className="px-3 py-2 text-white">{item.name}</td>
                              <td className="px-3 py-2 text-white/80">{item.plate || "—"}</td>
                              <td className="px-3 py-2 text-white/60">{item.last ? item.last.toLocaleString() : "Sem registro"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
