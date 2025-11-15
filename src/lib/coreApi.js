const BASE = "/api/core";

async function http(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "include",
    ...opts,
  });
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  if (!res.ok) {
    const body = isJson ? await res.json().catch(() => null) : await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText} → ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return isJson ? res.json() : res.text();
}

export const CoreApi = {
  // health compat no Nginx já responde 200
  health: () => fetch("/api/health").then((r) => r.ok),
  models: async (params) => {
    const query = buildQuery(params);
    const data = await http(`/models${query}`);
    return Array.isArray(data?.models) ? data.models : normaliseDevices(data);
  },
  createModel: (payload) => http("/models", { method: "POST", body: JSON.stringify(payload) }),
  listDevices: async (params) => {
    const query = buildQuery(params);
    const data = await http(`/devices${query}`);
    return Array.isArray(data?.devices) ? data.devices : normaliseDevices(data);
  },
  createDevice: (payload) => http("/devices", { method: "POST", body: JSON.stringify(payload) }),
  updateDevice: (id, payload) => http(`/devices/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  listChips: async (params) => {
    const query = buildQuery(params);
    const data = await http(`/chips${query}`);
    return Array.isArray(data?.chips) ? data.chips : normaliseDevices(data);
  },
  createChip: (payload) => http("/chips", { method: "POST", body: JSON.stringify(payload) }),
  updateChip: (id, payload) => http(`/chips/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  listVehicles: async (params) => {
    const query = buildQuery(params);
    const data = await http(`/vehicles${query}`);
    return Array.isArray(data?.vehicles) ? data.vehicles : normaliseDevices(data);
  },
  createVehicle: (payload) => http("/vehicles", { method: "POST", body: JSON.stringify(payload) }),
  updateVehicle: (id, payload) => http(`/vehicles/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteVehicle: (id, payload) =>
    http(`/vehicles/${id}`, {
      method: "DELETE",
      body: payload ? JSON.stringify(payload) : undefined,
      headers: payload ? { "Content-Type": "application/json" } : undefined,
    }),
};

function normaliseDevices(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.devices)) return payload.devices;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.rows)) return payload.rows;
  return [];
}

function buildQuery(params) {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return "";
  const search = new URLSearchParams(entries);
  return `?${search.toString()}`;
}
