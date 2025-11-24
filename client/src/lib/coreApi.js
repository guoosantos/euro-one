import api from "./api.js";
import { API_ROUTES } from "./api-routes.js";

const CORE_BASE = API_ROUTES.core.base;
const CRM_BASE = API_ROUTES.crm.base;

async function http(path, { method = "GET", params, payload, headers } = {}) {
  const url = path.startsWith("http") ? path : `${CORE_BASE}/${path.replace(/^\/+/, "")}`;
  const response = await api.request({ method, url, params, data: payload, headers });
  return response?.data ?? null;
}

async function crmHttp(path, { method = "GET", params, payload, headers } = {}) {
  const url = path.startsWith("http") ? path : `${CRM_BASE}/${path.replace(/^\/+/, "")}`;
  const response = await api.request({ method, url, params, data: payload, headers });
  return response?.data ?? null;
}

export const CoreApi = {
  // health compat no Nginx já responde 200
  health: () => api.get(API_ROUTES.health, { apiPrefix: false }).then((r) => r?.status === 200),
  models: async (params) => {
    const response = await api.get(API_ROUTES.models, { params });
    const data = response?.data || null;
    return Array.isArray(data?.models) ? data.models : normaliseDevices(data);
  },
  createModel: (payload) => http("models", { method: "POST", payload }),
  listDevices: async (params) => {
    const data = await http("devices", { params });
    return Array.isArray(data?.devices) ? data.devices : normaliseDevices(data);
  },
  createDevice: (payload) => http("devices", { method: "POST", payload }),
  updateDevice: (id, payload) => http(`devices/${id}`, { method: "PUT", payload }),
  listImportableDevices: async (params) => {
    const data = await http("devices/import", { params });
    return Array.isArray(data?.devices) ? data.devices : normaliseDevices(data);
  },
  importDevice: (payload) => http("devices/import", { method: "POST", payload }),
  listChips: async (params) => {
    const data = await http("chips", { params });
    return Array.isArray(data?.chips) ? data.chips : normaliseDevices(data);
  },
  createChip: (payload) => http("chips", { method: "POST", payload }),
  updateChip: (id, payload) => http(`chips/${id}`, { method: "PUT", payload }),
  listVehicles: async (params) => {
    const data = await http("vehicles", { params });
    return Array.isArray(data?.vehicles) ? data.vehicles : normaliseDevices(data);
  },
  createVehicle: (payload) => http("vehicles", { method: "POST", payload }),
  updateVehicle: (id, payload) => http(`vehicles/${id}`, { method: "PUT", payload }),
  deleteVehicle: (id, payload) => http(`vehicles/${id}`, { method: "DELETE", payload }),
  // tasks
  listTasks: (params) => http("tasks", { params }),
  createTask: (payload) => http("tasks", { method: "POST", payload }),
  updateTask: (id, payload) => http(`tasks/${id}`, { method: "PUT", payload }),
  // crm
  listCrmClients: (params) => crmHttp(API_ROUTES.crm.clients, { params }),
  createCrmClient: (payload) => crmHttp(API_ROUTES.crm.clients, { method: "POST", payload }),
  getCrmClient: (id, params) => crmHttp(`${API_ROUTES.crm.clients}/${id}`, { params }),
  updateCrmClient: (id, payload) => crmHttp(`${API_ROUTES.crm.clients}/${id}`, { method: "PUT", payload }),
  listCrmContacts: (clientId, params) => crmHttp(API_ROUTES.crm.contacts(clientId), { params }),
  addCrmContact: (clientId, payload) => crmHttp(API_ROUTES.crm.contacts(clientId), { method: "POST", payload }),
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

