export const API_ROUTES = {
  session: "session",
  login: "login",
  logout: "logout",
  events: "events",
  lastPositions: "positions/last",
  finance: "finance",
  driverBehavior: "driver-behavior",
  maintenance: "maintenance",
  fuel: "reports/fuel",
  routing: "routing",
  compliance: "compliance",
  iotSensors: "iot-sensors",
  videoTelematics: "video-telematics",
  positionsExport: "positions/export",
  reports: {
    trips: "reports/trips",
    stops: "reports/stops",
    summary: "reports/summary",
    route: "reports/route",
  },
  commands: "commands",
  notifications: "notifications",
  groups: "groups",
  userPreferences: "user/preferences",
  analytics: {
    eventsHeatmap: "events/heatmap",
  },
  crm: {
    base: "crm",
    // clients should be just "clients" so crmHttp builds /api/crm/clients
    clients: "clients",
    // contacts is a function that returns clients/:id/contacts
    contacts: (clientId) => `clients/${clientId}/contacts`,
    // alerts endpoint under /api/crm/alerts
    alerts: "alerts",
  },
  clients: "clients",
  users: "users",
  models: "models",
  geofences: "geofences",
  drivers: "drivers",
  media: {
    faceAlerts: "media/face/alerts",
  },
  core: {
    base: "core",
    models: "core/models",
    devices: "core/devices",
    importDevices: "core/devices/import",
    chips: "core/chips",
    vehicles: "core/vehicles",
    telemetry: "core/telemetry",
  },
  health: "health",
  traccarHealth: "health/traccar",
};

export default API_ROUTES;
