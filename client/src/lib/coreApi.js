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
    return normaliseListPayload(data);
  },
  searchModels: async (params) => {
    const response = await api.get(API_ROUTES.models, { params });
    return response?.data || null;
  },
  createModel: (payload) => http("models", { method: "POST", payload }),
  updateModel: (id, payload) => http(`models/${id}`, { method: "PUT", payload }),
  listDevices: async (params) => {
    const data = await http("devices", { params });
    return normaliseListPayload(data);
  },
  searchDevices: (params) => http("devices", { params }),
  createDevice: (payload) => http("devices", { method: "POST", payload }),
  updateDevice: (id, payload) => http(`devices/${id}`, { method: "PUT", payload }),
  deleteDevice: (id, params) => http(`devices/${id}`, { method: "DELETE", params }),
  listImportableDevices: async (params) => {
    const data = await http("devices/import", { params });
    return normaliseListPayload(data);
  },
  importDevice: (payload) => http("devices/import", { method: "POST", payload }),
  syncDevicesFromTraccar: (payload) => http("devices/sync", { method: "POST", payload }),
  listChips: async (params) => {
    const data = await http("chips", { params });
    return normaliseListPayload(data);
  },
  searchChips: (params) => http("chips", { params }),
  createChip: (payload) => http("chips", { method: "POST", payload }),
  updateChip: (id, payload) => http(`chips/${id}`, { method: "PUT", payload }),
  deleteChip: (id, params) => http(`chips/${id}`, { method: "DELETE", params }),
  listVehicles: async (params) => {
    const data = await http("vehicles", { params });
    return normaliseListPayload(data);
  },
  searchVehicles: (params) => http("vehicles", { params }),
  listVehicleAttributes: async (params) => {
    const data = await http("vehicle-attributes", { params });
    return normaliseListPayload(data);
  },
  createVehicleAttribute: (payload) => http("vehicle-attributes", { method: "POST", payload }),
  createVehicle: (payload) => http("vehicles", { method: "POST", payload }),
  updateVehicle: (id, payload) => http(`vehicles/${id}`, { method: "PUT", payload }),
  deleteVehicle: (id, payload) => http(`vehicles/${id}`, { method: "DELETE", payload }),
  linkDeviceToVehicle: (vehicleId, deviceId, payload) =>
    http(`vehicles/${vehicleId}/devices/${deviceId}`, { method: "POST", payload }),
  unlinkDeviceFromVehicle: (vehicleId, deviceId, params) =>
    http(`vehicles/${vehicleId}/devices/${deviceId}`, { method: "DELETE", params }),
  listStockItems: (params) => http("stock", { params }).then((data) => data?.items || []),
  createStockItem: (payload) => http("stock", { method: "POST", payload }),
  updateStockItem: (id, payload) => http(`stock/${id}`, { method: "PUT", payload }),
  deleteStockItem: (id, params) => http(`stock/${id}`, { method: "DELETE", params }),
  importEuroXlsx: (payload) => http("euro/import-xlsx", { method: "POST", payload }),
  // tasks
  listTasks: (params) => http("tasks", { params }),
  createTask: (payload) => http("tasks", { method: "POST", payload }),
  updateTask: (id, payload) => http(`tasks/${id}`, { method: "PUT", payload }),
  searchTechnicians: (params) => http("technicians", { params }),
  // crm
  listCrmClients: (params) => crmHttp(API_ROUTES.crm.clients, { params }),
  searchCrmClients: (params) => crmHttp(API_ROUTES.crm.clients, { params }),
  createCrmClient: (payload) => crmHttp(API_ROUTES.crm.clients, { method: "POST", payload }),
  getCrmClient: (id, params) => crmHttp(`${API_ROUTES.crm.clients}/${id}`, { params }),
  updateCrmClient: (id, payload) => crmHttp(`${API_ROUTES.crm.clients}/${id}`, { method: "PUT", payload }),
  listCrmContacts: (clientId, params) => crmHttp(API_ROUTES.crm.contacts(clientId), { params }),
  addCrmContact: (clientId, payload) => crmHttp(API_ROUTES.crm.contacts(clientId), { method: "POST", payload }),
  listCrmAlerts: (params) => crmHttp(API_ROUTES.crm.alerts, { params }),
  listCrmTags: (params) => crmHttp(API_ROUTES.crm.tags, { params }),
  createCrmTag: (payload) => crmHttp(API_ROUTES.crm.tags, { method: "POST", payload }),
  deleteCrmTag: (id) => crmHttp(`${API_ROUTES.crm.tags}/${id}`, { method: "DELETE" }),
  listCrmPipeline: (params) => crmHttp(API_ROUTES.crm.pipeline, { params }),
  createDeal: (payload) => crmHttp(API_ROUTES.crm.deals, { method: "POST", payload }),
  moveDealStage: (id, payload) => crmHttp(`${API_ROUTES.crm.deals}/${id}/stage`, { method: "PUT", payload }),
  listCrmActivities: (params) => crmHttp(API_ROUTES.crm.activities, { params }),
  createCrmActivity: (payload) => crmHttp(API_ROUTES.crm.activities, { method: "POST", payload }),
  listCrmReminders: (params) => crmHttp(API_ROUTES.crm.reminders, { params }),
  createCrmReminder: (payload) => crmHttp(API_ROUTES.crm.reminders, { method: "POST", payload }),
};

export function normaliseListPayload(payload) {
  if (!payload) return [];

  const candidates = [];
  const enqueue = (value) => {
    if (value === undefined || value === null) return;
    candidates.push(value);
    if (value && typeof value === "object" && !Array.isArray(value) && value.data !== undefined) {
      candidates.push(value.data);
    }
  };

  enqueue(payload);

  const pickArray = (value) => {
    if (!value) return null;
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const key of ["devices", "items", "data", "results", "rows", "models", "chips", "vehicles"]) {
        if (Array.isArray(value[key])) return value[key];
      }
    }
    return null;
  };

  for (const candidate of candidates) {
    const direct = pickArray(candidate);
    if (direct) return direct;

    if (candidate && typeof candidate === "object") {
      const firstArray = Object.values(candidate).find(Array.isArray);
      if (Array.isArray(firstArray)) return firstArray;
    }
  }

  return [];
}
