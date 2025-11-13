const BASE = "/api/core";

async function http(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts.headers||{}) },
    credentials: "include",
    ...opts
  });
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  if (!res.ok) {
    const body = isJson ? await res.json().catch(()=>null) : await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} → ${typeof body==='string'?body:JSON.stringify(body)}`);
  }
  return isJson ? res.json() : res.text();
}

export const CoreApi = {
  // health compat no Nginx já responde 200
  health: () => fetch("/api/health").then(r=>r.ok),
  models: () => http("/models"),
  listDevices: () => http("/devices"),
  createDevice: (payload) => http("/devices", { method: "POST", body: JSON.stringify(payload) }),
  positionsBetween: ({deviceId, from, to}) => {
    const qs = new URLSearchParams();
    if (deviceId) qs.set("deviceId", deviceId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return http(`/positions?${qs.toString()}`);
  },
  lastPosition: async (deviceId) => {
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 1000*60*60*24*7).toISOString(); // 7 dias
    const list = await CoreApi.positionsBetween({deviceId, from, to});
    return Array.isArray(list) && list.length ? list[list.length - 1] : null;
  }
};
