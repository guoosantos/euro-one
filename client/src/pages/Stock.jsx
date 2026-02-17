import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapPin, RefreshCw, Search, Send, Users } from "lucide-react";
import L from "leaflet";
import { Circle, MapContainer, Marker, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import api, { clearApiCaches } from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { API_ROUTES } from "../lib/api-routes.js";
import { useTenant } from "../lib/tenant-context.jsx";
import { usePermissionGate } from "../lib/permissions/permission-gate.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import DataTablePagination from "../ui/DataTablePagination.jsx";
import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import { leafletDefaultIcon } from "../lib/map/leaflet-default-icon.js";
import { DEFAULT_MAP_LAYER } from "../lib/mapLayers.js";
import { useConfirmDialog } from "../components/ui/ConfirmDialogProvider.jsx";
import useAdminGeneralAccess from "../lib/hooks/useAdminGeneralAccess.js";
import usePageToast from "../lib/hooks/usePageToast.js";
import PageToast from "../components/ui/PageToast.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import { isAdminGeneralClientName } from "../lib/admin-general.js";
import { resolveEquipmentDisplayCode } from "../lib/equipment-display.js";
import { isServiceStockGlobalPermissionGroup } from "../lib/permissions/profile-groups.js";

const FILTER_OPTIONS = [
  { value: "both", label: "Ambos" },
  { value: "available", label: "Disponíveis" },
  { value: "linked", label: "Vinculados" },
];

const DEFAULT_CENTER = [-15.7801, -47.9292];
const CONDITION_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "novo", label: "Novos" },
  { value: "usado_funcionando", label: "Usados Funcionando" },
  { value: "usado_defeito", label: "Usados Defeito" },
];
const KIT_CONDITION_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "novo", label: "Novo" },
  { value: "usado", label: "Usado" },
];
const PAGE_SIZE_OPTIONS = [5, 20, 50, 100, 500, 1000, 5000];
const GLOBAL_KIT_CLIENT_ID = "all";
const TRANSFER_DESTINATION_TYPES = {
  CLIENT: "client",
  TECHNICIAN: "technician",
  CLIENT_TECHNICIAN: "client_technician",
  BASE_RETURN: "base_return",
  BASE_MAINTENANCE: "base_maintenance",
};

const TRANSFER_DESTINATION_OPTIONS_ADMIN = [
  { value: TRANSFER_DESTINATION_TYPES.CLIENT, label: "Destino: Cliente" },
  { value: TRANSFER_DESTINATION_TYPES.TECHNICIAN, label: "Destino: Técnico" },
  { value: TRANSFER_DESTINATION_TYPES.CLIENT_TECHNICIAN, label: "Destino: Cliente + Técnico" },
  { value: TRANSFER_DESTINATION_TYPES.BASE_RETURN, label: "Base Euro: Devolução" },
  { value: TRANSFER_DESTINATION_TYPES.BASE_MAINTENANCE, label: "Base Euro: Manutenção" },
];

const TRANSFER_DESTINATION_OPTIONS_CLIENT = [
  { value: TRANSFER_DESTINATION_TYPES.TECHNICIAN, label: "Destino: Técnico" },
  { value: TRANSFER_DESTINATION_TYPES.BASE_RETURN, label: "Base Euro: Devolução" },
  { value: TRANSFER_DESTINATION_TYPES.BASE_MAINTENANCE, label: "Base Euro: Manutenção" },
];
const TRANSFER_OWNERSHIP_OPTIONS = [
  { value: "COMODATO", label: "Comodato" },
  { value: "VENDA", label: "Venda" },
];
const TRANSFER_SELECTION_MODES = {
  EQUIPMENTS: "equipments",
  KIT: "kit",
};

function normalizeOwnershipTypeValue(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "VENDA" ? "VENDA" : "COMODATO";
}

function isTransferToTechnician(destinationType) {
  return (
    destinationType === TRANSFER_DESTINATION_TYPES.TECHNICIAN ||
    destinationType === TRANSFER_DESTINATION_TYPES.CLIENT_TECHNICIAN
  );
}

function isTransferToClient(destinationType) {
  return (
    destinationType === TRANSFER_DESTINATION_TYPES.CLIENT ||
    destinationType === TRANSFER_DESTINATION_TYPES.CLIENT_TECHNICIAN
  );
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div
        className="flex-1 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Fechar painel"
      />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Estoque</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description ? <p className="mt-1 text-sm text-white/60">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/70 hover:border-white/30 hover:text-white"
          >
            Fechar
          </button>
        </div>
        <div className="h-[calc(100vh-120px)] overflow-y-auto px-6 py-6">{children}</div>
      </div>
    </div>
  );
}

function resolveDeviceCoords(device) {
  const attrs = device?.attributes || {};
  const position = attrs.position || attrs.lastPosition || {};
  const lat = Number(
    device?.latitude ??
      device?.lat ??
      position.latitude ??
      position.lat ??
      attrs.latitude ??
      attrs.lat ??
      null,
  );
  const lng = Number(
    device?.longitude ??
      device?.lng ??
      device?.lon ??
      position.longitude ??
      position.lon ??
      attrs.longitude ??
      attrs.lon ??
      null,
  );
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function resolveTechnicianAddress(technician) {
  if (!technician) return "";
  if (technician.address) return technician.address;
  const parts = [
    technician.street,
    technician.number,
    technician.district,
    technician.city,
    technician.state,
  ].filter(Boolean);
  return parts.join(", ");
}

function resolveClientLocation(client) {
  if (!client || typeof client !== "object") {
    return { city: "", state: "", address: "" };
  }
  const attributes = client.attributes && typeof client.attributes === "object" ? client.attributes : {};
  const address = attributes.address && typeof attributes.address === "object" ? attributes.address : {};
  const city =
    client.city ||
    attributes.city ||
    attributes.cidade ||
    address.city ||
    address.cidade ||
    "";
  const state =
    client.state ||
    attributes.state ||
    attributes.uf ||
    attributes.estado ||
    address.state ||
    address.uf ||
    address.estado ||
    "";
  const street =
    attributes.street ||
    address.street ||
    address.road ||
    address.logradouro ||
    "";
  const number = attributes.number || address.number || address.numero || "";
  const district =
    attributes.district ||
    address.district ||
    address.neighborhood ||
    address.bairro ||
    "";
  const zip = attributes.zip || attributes.cep || address.zip || address.cep || "";
  const addressText = [street, number, district, city, state, zip].filter(Boolean).join(", ");
  return {
    city: String(city || "").trim(),
    state: String(state || "").trim(),
    address: addressText,
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radius * c;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveRequestErrorMessage(error, fallback) {
  return error?.response?.data?.message || error?.message || fallback;
}

function resolveDeviceCondition(device) {
  return (
    normalizeText(device?.condition) ||
    normalizeText(device?.attributes?.condition) ||
    "novo"
  );
}

function formatConditionLabel(condition) {
  if (condition === "usado_funcionando") return "Usado Funcionando";
  if (condition === "usado_defeito") return "Usado Defeito";
  return "Novo";
}

function normalizeKitCondition(condition) {
  const normalized = String(condition || "").trim().toLowerCase();
  if (!normalized || normalized === "novo") return "novo";
  if (normalized.includes("novo")) return "novo";
  if (normalized === "new") return "novo";
  return "usado";
}

function normalizeKitItemCondition(condition) {
  const normalized = String(condition || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized || normalized === "new" || normalized.includes("novo")) return "novo";
  if (normalized.includes("usado_funcionando") || normalized.includes("used_working")) return "usado_funcionando";
  if (normalized.includes("usado_defeito") || normalized.includes("defeito") || normalized.includes("fault")) {
    return "usado_defeito";
  }
  if (normalized.includes("manutencao") || normalized.includes("maintenance")) return "manutencao";
  if (normalized.includes("usado") || normalized.includes("used")) return "usado";
  return normalized;
}

function resolveKitItemConditionBucket(condition) {
  const normalized = normalizeKitItemCondition(condition);
  return normalized === "novo" ? "novo" : "usado";
}

function formatKitItemConditionLabel(condition) {
  const normalized = normalizeKitItemCondition(condition);
  if (normalized === "novo") return "Novo";
  if (normalized === "usado") return "Usado";
  if (normalized === "usado_funcionando") return "Usado Funcionando";
  if (normalized === "usado_defeito") return "Usado com Defeito";
  if (normalized === "manutencao") return "Manutenção";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatKitLinkedAtValue(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString("pt-BR");
}

function resolveKitDetailItemKey(item) {
  if (item?.id !== undefined && item?.id !== null) return String(item.id);
  if (item?.displayId) return String(item.displayId);
  if (item?.uniqueId) return String(item.uniqueId);
  return "";
}

function resolveDeviceAddress(device) {
  return (
    device?.address ||
    device?.formattedAddress ||
    device?.attributes?.addressSearch ||
    device?.attributes?.address ||
    device?.attributes?.formattedAddress ||
    device?.attributes?.shortAddress ||
    ""
  );
}

function resolveDeviceTechnicianReference(device) {
  const attributes = device?.attributes || {};
  const rawTechnician = attributes.technician || attributes.tecnico || null;
  const technicianId =
    attributes.technicianId ||
    attributes.technician?.id ||
    attributes.technician?.technicianId ||
    (rawTechnician && typeof rawTechnician === "object" ? rawTechnician.id : null);
  const technicianName =
    attributes.technicianName ||
    attributes.technician?.name ||
    (typeof rawTechnician === "string" ? rawTechnician : rawTechnician?.name) ||
    null;
  return {
    id: technicianId ? String(technicianId) : null,
    name: technicianName ? String(technicianName) : null,
  };
}

function resolveStockLocationLabel(device) {
  if (device?.vehicleId) return "No Veículo";
  return resolveDeviceAddress(device) || [device?.city, device?.state].filter(Boolean).join(" - ") || "Base";
}

export default function Stock() {
  const {
    tenantId,
    tenantScope,
    homeClientId,
    user,
    tenants,
    hasAdminAccess,
    isAuthenticated,
    permissionsReady,
    initialising,
    loading: tenantLoading,
    permissionLoading,
    contextSwitching,
    permissionContext,
  } = useTenant();
  const stockPermission = usePermissionGate({
    menuKey: "primary",
    pageKey: "devices",
    subKey: "devices-stock",
  });
  const isTechnician = user?.role === "technician";
  const isServiceStockGlobalProfile = isServiceStockGlobalPermissionGroup(permissionContext);
  const canManageKitModels = !isServiceStockGlobalProfile;
  const baseLayer = DEFAULT_MAP_LAYER;
  const tileUrl = baseLayer?.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileAttribution =
    baseLayer?.attribution || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  const tileSubdomains = baseLayer?.subdomains ?? "abc";
  const tileMaxZoom = baseLayer?.maxZoom;
  const [devices, setDevices] = useState([]);
  const [models, setModels] = useState([]);
  const [kitModels, setKitModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("geral");
  const [searchClient, setSearchClient] = useState("");
  const [generalFilters, setGeneralFilters] = useState({
    clientId: "",
    deviceId: "",
    modelId: "",
    address: null,
    availability: "both",
  });
  const { confirmDelete } = useConfirmDialog();
  const { isAdminGeneral } = useAdminGeneralAccess();
  const { toast, showToast } = usePageToast();
  const [draftFilters, setDraftFilters] = useState({
    clientId: "",
    deviceId: "",
    modelId: "",
    availability: "both",
  });
  const [conditionFilter, setConditionFilter] = useState("all");
  const [generalPage, setGeneralPage] = useState(1);
  const [generalPageSize, setGeneralPageSize] = useState(20);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [radiusKm, setRadiusKm] = useState("10");
  const [technicians, setTechnicians] = useState([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [transferDrawerOpen, setTransferDrawerOpen] = useState(false);
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferSelectionMode, setTransferSelectionMode] = useState(TRANSFER_SELECTION_MODES.EQUIPMENTS);
  const [transferKitId, setTransferKitId] = useState("");
  const [transferKitSearch, setTransferKitSearch] = useState("");
  const [transferKits, setTransferKits] = useState([]);
  const [transferKitsLoading, setTransferKitsLoading] = useState(false);
  const [detailsClientId, setDetailsClientId] = useState(null);
  const [detailsTab, setDetailsTab] = useState("linked");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [transferFilters, setTransferFilters] = useState({
    clientId: "",
    deviceId: "",
    modelId: "",
    address: null,
  });
  const [transferConditionFilter, setTransferConditionFilter] = useState("all");
  const [transferForm, setTransferForm] = useState({
    sourceClientId: "",
    destinationType: TRANSFER_DESTINATION_TYPES.CLIENT,
    destinationClientId: "",
    destinationTechnicianId: "",
    ownershipType: "COMODATO",
    city: "",
    state: "",
    address: "",
    referencePoint: "",
    latitude: "",
    longitude: "",
    notes: "",
  });
  const [mapAddressValue, setMapAddressValue] = useState({ formattedAddress: "" });
  const [transferAddressValue, setTransferAddressValue] = useState({ formattedAddress: "" });
  const [transferAddressResetKey, setTransferAddressResetKey] = useState(0);
  const [generalAddressResetKey, setGeneralAddressResetKey] = useState(0);
  const [generalAddressSelection, setGeneralAddressSelection] = useState(null);
  const [regionTarget, setRegionTarget] = useState(null);
  const [savingKit, setSavingKit] = useState(false);
  const [kitModelForm, setKitModelForm] = useState({ name: "", code: "" });
  const [kitModelDrafts, setKitModelDrafts] = useState({});
  const [kitDraft, setKitDraft] = useState({ modelId: "", name: "", equipmentIds: [] });
  const [kitSearch, setKitSearch] = useState("");
  const [kitClientId, setKitClientId] = useState("");
  const [kitSubview, setKitSubview] = useState("modelo");
  const [kitStockClientId, setKitStockClientId] = useState("");
  const [kitStockCondition, setKitStockCondition] = useState("all");
  const [kitStockItems, setKitStockItems] = useState([]);
  const [kitStockLoading, setKitStockLoading] = useState(false);
  const [kitDetailsDrawerOpen, setKitDetailsDrawerOpen] = useState(false);
  const [kitDetailsLoading, setKitDetailsLoading] = useState(false);
  const [kitDetailsError, setKitDetailsError] = useState("");
  const [selectedKitDetails, setSelectedKitDetails] = useState(null);
  const [kitDetailsItems, setKitDetailsItems] = useState([]);
  const [kitDetailsSearch, setKitDetailsSearch] = useState("");
  const [kitDetailsCondition, setKitDetailsCondition] = useState("all");
  const [kitDetailsObservationDrafts, setKitDetailsObservationDrafts] = useState({});
  const [kitDetailsSavingObservation, setKitDetailsSavingObservation] = useState({});
  const [technicianStockRows, setTechnicianStockRows] = useState([]);
  const [technicianStockLoading, setTechnicianStockLoading] = useState(false);
  const mapRef = useRef(null);
  const { onMapReady, map } = useMapLifecycle({ mapRef });

  const bootReady =
    isAuthenticated && permissionsReady && !initialising && !tenantLoading && !permissionLoading && !contextSwitching;
  const resolvedClientId = tenantScope === "ALL" ? null : (tenantId || user?.clientId || null);
  const fallbackHomeClientId = String(homeClientId || user?.clientId || "").trim();
  const adminGeneralClientId = useMemo(() => {
    if (!hasAdminAccess) return "";
    const adminGeneralTenant = (Array.isArray(tenants) ? tenants : []).find((tenant) =>
      isAdminGeneralClientName(tenant?.name || tenant?.company || ""),
    );
    if (adminGeneralTenant?.id !== undefined && adminGeneralTenant?.id !== null) {
      return String(adminGeneralTenant.id);
    }
    const fallbackClientId = fallbackHomeClientId || String(resolvedClientId || "").trim();
    if (fallbackClientId && fallbackClientId.toLowerCase() !== GLOBAL_KIT_CLIENT_ID) {
      return fallbackClientId;
    }
    return "";
  }, [fallbackHomeClientId, hasAdminAccess, resolvedClientId, tenants]);
  const kitEuroOneOptionValue = adminGeneralClientId || GLOBAL_KIT_CLIENT_ID;
  const normalizedKitClientId = hasAdminAccess ? String(kitClientId || "").trim() : (resolvedClientId || "");
  const isGlobalKitClient = hasAdminAccess && normalizedKitClientId === GLOBAL_KIT_CLIENT_ID;
  const effectiveKitClientId = hasAdminAccess ? normalizedKitClientId : (resolvedClientId || "");
  const isKitClientReady = Boolean(effectiveKitClientId);
  const isAdminAllClientsContext = hasAdminAccess && tenantScope === "ALL";
  const isEuroOneKitContext =
    hasAdminAccess &&
    (String(kitClientId || "") === String(kitEuroOneOptionValue) ||
      String(kitClientId || "") === GLOBAL_KIT_CLIENT_ID);
  const shouldUseGlobalKitDevices = isAdminAllClientsContext && isEuroOneKitContext;

  useEffect(() => {
    if (!canManageKitModels && kitSubview === "modelo") {
      setKitSubview("kit");
    }
  }, [canManageKitModels, kitSubview]);

  useEffect(() => {
    const defaultGeneralClientId = hasAdminAccess || isTechnician ? "" : resolvedClientId || "";
    const defaultKitClientId = hasAdminAccess
      ? String(adminGeneralClientId || resolvedClientId || user?.clientId || "")
      : resolvedClientId || "";
    const defaultKitStockClientId = hasAdminAccess ? GLOBAL_KIT_CLIENT_ID : defaultKitClientId;
    setGeneralFilters({
      clientId: defaultGeneralClientId,
      deviceId: "",
      modelId: "",
      address: null,
      availability: "both",
    });
    setDraftFilters({
      clientId: defaultGeneralClientId,
      deviceId: "",
      modelId: "",
      availability: "both",
    });
    setTransferFilters({
      clientId: defaultGeneralClientId,
      deviceId: "",
      modelId: "",
      address: null,
    });
    setTransferSelectionMode(TRANSFER_SELECTION_MODES.EQUIPMENTS);
    setTransferKitId("");
    setTransferKitSearch("");
    setTransferKits([]);
    setTransferKitsLoading(false);
    setTransferConditionFilter("all");
    setTransferAddressResetKey((prev) => prev + 1);
    setConditionFilter("all");
    setGeneralAddressSelection(null);
    setGeneralAddressResetKey((prev) => prev + 1);
    setKitDraft({ modelId: "", name: "", equipmentIds: [] });
    setKitSearch("");
    setKitSubview("modelo");
    setKitClientId(defaultKitClientId);
    setKitStockClientId(defaultKitStockClientId);
    setKitStockCondition("all");
    setKitModels([]);
    setKitStockItems([]);
    setKitDetailsDrawerOpen(false);
    setKitDetailsLoading(false);
    setKitDetailsError("");
    setSelectedKitDetails(null);
    setKitDetailsItems([]);
    setKitDetailsSearch("");
    setKitDetailsCondition("all");
    setKitDetailsObservationDrafts({});
    setKitDetailsSavingObservation({});
    setTechnicianStockRows([]);
    setTechnicianStockLoading(false);
  }, [adminGeneralClientId, hasAdminAccess, isTechnician, resolvedClientId, user?.clientId]);

  const loadStock = useCallback(async () => {
    if (!bootReady) return;
    if (isTechnician) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = !isAdminGeneral && resolvedClientId ? { clientId: resolvedClientId } : undefined;
      const modelParams = {
        ...(params || {}),
        ...(isServiceStockGlobalProfile ? { scope: "both" } : {}),
      };
      const [deviceList, modelList] = await Promise.all([CoreApi.listDevices(params), CoreApi.models(modelParams)]);
      let kitModelList = [];
      if (effectiveKitClientId) {
        const kitParams =
          effectiveKitClientId === GLOBAL_KIT_CLIENT_ID
            ? { clientId: GLOBAL_KIT_CLIENT_ID }
            : { clientId: effectiveKitClientId };
        const loadedKitModels = await CoreApi.listKitModels(kitParams);
        kitModelList = loadedKitModels;
      }
      setDevices(Array.isArray(deviceList) ? deviceList : []);
      setModels(Array.isArray(modelList) ? modelList : []);
      setKitModels(Array.isArray(kitModelList) ? kitModelList : []);
    } catch (error) {
      console.error("Falha ao carregar estoque", error);
      setDevices([]);
      setKitModels([]);
    } finally {
      setLoading(false);
    }
  }, [bootReady, effectiveKitClientId, isAdminGeneral, isServiceStockGlobalProfile, isTechnician, resolvedClientId]);

  const loadTechnicianStock = useCallback(async () => {
    if (!bootReady || !isTechnician) return;
    setTechnicianStockLoading(true);
    try {
      const params = {
        ...(generalFilters.clientId ? { clientId: generalFilters.clientId } : {}),
        ...(generalFilters.deviceId ? { deviceId: generalFilters.deviceId } : {}),
        ...(generalFilters.modelId ? { modelId: generalFilters.modelId } : {}),
        ...(generalFilters.availability ? { availability: generalFilters.availability } : {}),
        ...(generalFilters.address?.label ||
        generalFilters.address?.concise ||
        generalFilters.address?.address
          ? {
              address:
                generalFilters.address?.label ||
                generalFilters.address?.concise ||
                generalFilters.address?.address,
            }
          : {}),
      };
      const list = await CoreApi.listTechnicianStock(params);
      setTechnicianStockRows(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("Falha ao carregar estoque do técnico", error);
      setTechnicianStockRows([]);
    } finally {
      setTechnicianStockLoading(false);
    }
  }, [bootReady, generalFilters, isTechnician]);

  useEffect(() => {
    if (!bootReady) return;
    if (isTechnician) {
      void loadTechnicianStock();
      return;
    }
    void loadStock();
  }, [bootReady, isTechnician, loadStock, loadTechnicianStock]);

  useEffect(() => {
    if (isTechnician && view === "mapa") {
      setView("geral");
    }
  }, [isTechnician, view]);

  const loadKitStock = useCallback(async () => {
    if (!bootReady) return;
    const scopedClientId = hasAdminAccess ? String(kitStockClientId || "").trim() : String(resolvedClientId || "").trim();
    if (!scopedClientId) {
      setKitStockItems([]);
      return;
    }
    setKitStockLoading(true);
    try {
      const loaded = await CoreApi.listKits({ clientId: scopedClientId });
      setKitStockItems(Array.isArray(loaded) ? loaded : []);
    } catch (error) {
      console.error("Falha ao carregar estoque de kits", error);
      setKitStockItems([]);
    } finally {
      setKitStockLoading(false);
    }
  }, [bootReady, hasAdminAccess, kitStockClientId, resolvedClientId]);

  useEffect(() => {
    if (!bootReady) return;
    void loadKitStock();
  }, [bootReady, loadKitStock]);

  useEffect(() => {
    if (!bootReady) {
      setTechnicians([]);
      setTechniciansLoading(false);
      return;
    }
    let cancelled = false;
    const loadTechnicians = async () => {
      setTechniciansLoading(true);
      try {
        const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
        const response = await api.get("core/technicians", { params });
        const list = response?.data?.items || [];
        if (!cancelled) {
          setTechnicians(Array.isArray(list) ? list : []);
        }
      } catch (error) {
        if (!cancelled) {
          console.error("Falha ao carregar técnicos", error);
          setTechnicians([]);
        }
      } finally {
        if (!cancelled) {
          setTechniciansLoading(false);
        }
      }
    };

    loadTechnicians();
    return () => {
      cancelled = true;
    };
  }, [bootReady, resolvedClientId]);

  const modelById = useMemo(() => {
    const map = new Map();
    models.forEach((model) => {
      if (model?.id !== undefined && model?.id !== null) {
        map.set(String(model.id), model);
        map.set(model.id, model);
      }
    });
    return map;
  }, [models]);

  const deviceById = useMemo(() => {
    const map = new Map();
    devices.forEach((device) => {
      if (device?.id === undefined || device?.id === null) return;
      map.set(String(device.id), device);
    });
    return map;
  }, [devices]);

  useEffect(() => {
    const drafts = {};
    kitModels.forEach((model) => {
      drafts[String(model.id)] = model.name || "";
    });
    setKitModelDrafts(drafts);
  }, [kitModels]);

  useEffect(() => {
    setKitDraft({ modelId: "", name: "", equipmentIds: [] });
    setKitSearch("");
  }, [effectiveKitClientId]);

  const kitModelOptions = useMemo(
    () =>
      kitModels.map((model) => ({
        value: String(model.id),
        label: `${model.code || "--"} · ${model.name || "Modelo sem nome"}`,
        description: `Código ${model.code || "--"}`,
      })),
    [kitModels],
  );

  const clientNameById = useMemo(() => {
    const map = new Map();
    (tenants || []).forEach((tenant) => {
      map.set(String(tenant.id), tenant.name || tenant.company || tenant.id);
    });
    return map;
  }, [tenants]);
  const resolveDeviceClientId = useCallback((device) => {
    const candidate =
      device?.clientId ??
      device?.client?.id ??
      device?.vehicle?.clientId ??
      device?.vehicle?.client?.id ??
      null;
    if (candidate === null || candidate === undefined) return null;
    const normalized = String(candidate).trim();
    return normalized || null;
  }, []);
  const resolveDeviceClientName = useCallback(
    (device) => {
      const clientId = resolveDeviceClientId(device);
      if (clientId && clientNameById.has(clientId)) {
        return clientNameById.get(clientId);
      }
      const explicitName =
        device?.clientName ||
        device?.client?.name ||
        device?.vehicle?.clientName ||
        device?.vehicle?.client?.name ||
        "";
      const normalizedName = String(explicitName || "").trim();
      if (normalizedName) return normalizedName;
      if (clientId) return `Cliente ${clientId.slice(0, 6)}`;
      return "EURO ONE";
    },
    [clientNameById, resolveDeviceClientId],
  );

  const clientOptions = useMemo(
    () =>
      (Array.isArray(tenants) ? tenants : []).map((tenant) => ({
        id: tenant.id,
        name: tenant.name || tenant.company || tenant.id,
        ...resolveClientLocation(tenant),
      })),
    [tenants],
  );

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
      })),
    [clientOptions],
  );

  const transferClientAutocompleteOptions = useMemo(() => {
    const map = new Map();
    const addOption = (value, label, extras = {}) => {
      const normalizedValue = String(value || "").trim();
      if (!normalizedValue) return;
      if (map.has(normalizedValue)) return;
      map.set(normalizedValue, {
        value: normalizedValue,
        label: String(label || normalizedValue),
        city: String(extras.city || "").trim(),
        state: String(extras.state || "").trim(),
        address: String(extras.address || "").trim(),
      });
    };

    if (isAdminGeneral && adminGeneralClientId) {
      addOption(adminGeneralClientId, "EURO ONE");
    }
    clientOptions.forEach((client) =>
      addOption(client.id, client.name, { city: client.city, state: client.state, address: client.address }),
    );
    return Array.from(map.values());
  }, [adminGeneralClientId, clientOptions, isAdminGeneral]);

  const transferClientById = useMemo(() => {
    const map = new Map();
    transferClientAutocompleteOptions.forEach((option) => {
      if (!option?.value) return;
      map.set(String(option.value), option);
    });
    return map;
  }, [transferClientAutocompleteOptions]);

  const loadClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = normalizeText(query);
      const filtered = clientAutocompleteOptions.filter((client) =>
        normalizeText(client.label).includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [clientAutocompleteOptions],
  );

  const loadTransferClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = normalizeText(query);
      const filtered = transferClientAutocompleteOptions.filter((client) =>
        normalizeText(client.label).includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [transferClientAutocompleteOptions],
  );

  const kitClientAutocompleteOptions = useMemo(() => {
    if (!hasAdminAccess) return clientAutocompleteOptions;
    const euroOneOption = { value: kitEuroOneOptionValue, label: "EURO ONE" };
    const filteredClients = clientAutocompleteOptions.filter(
      (option) => String(option.value) !== String(kitEuroOneOptionValue),
    );
    return [euroOneOption, ...filteredClients];
  }, [clientAutocompleteOptions, hasAdminAccess, kitEuroOneOptionValue]);

  const loadKitClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = normalizeText(query);
      const filtered = kitClientAutocompleteOptions.filter((client) =>
        normalizeText(client.label).includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [kitClientAutocompleteOptions],
  );

  const kitStockClientAutocompleteOptions = useMemo(() => {
    const euroOneOption = { value: GLOBAL_KIT_CLIENT_ID, label: "EURO ONE" };
    const filteredClients = clientAutocompleteOptions.filter(
      (option) => String(option.value) !== GLOBAL_KIT_CLIENT_ID,
    );
    return [euroOneOption, ...filteredClients];
  }, [clientAutocompleteOptions]);

  const loadKitStockClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = normalizeText(query);
      const filtered = kitStockClientAutocompleteOptions.filter((client) =>
        normalizeText(client.label).includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [kitStockClientAutocompleteOptions],
  );

  const technicianOptions = useMemo(
    () => (Array.isArray(technicians) ? technicians : []).map((technician) => ({
      id: technician.id,
      name: technician.name || technician.fullName || technician.email || String(technician.id),
      address: technician.address || "",
      street: technician.street || "",
      number: technician.number || "",
      district: technician.district || "",
      city: technician.city || "",
      state: technician.state || "",
      latitude: technician.latitude ?? "",
      longitude: technician.longitude ?? "",
    })),
    [technicians],
  );

  const technicianById = useMemo(() => {
    const map = new Map();
    technicianOptions.forEach((technician) => {
      if (technician?.id !== undefined && technician?.id !== null) {
        map.set(String(technician.id), technician);
      }
    });
    return map;
  }, [technicianOptions]);

  const technicianAutocompleteOptions = useMemo(
    () =>
      technicianOptions.map((technician) => ({
        value: technician.id,
        label: technician.name,
        description: resolveTechnicianAddress(technician),
      })),
    [technicianOptions],
  );

  const loadTechnicianOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = normalizeText(query);
      const filtered = technicianAutocompleteOptions.filter((technician) => {
        const haystack = [technician.label, technician.description].filter(Boolean).join(" ");
        return normalizeText(haystack).includes(term);
      });
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [technicianAutocompleteOptions],
  );

  const availableDevices = useMemo(() => devices.filter((device) => !device.vehicleId), [devices]);
  const linkedDevices = useMemo(() => devices.filter((device) => device.vehicleId), [devices]);

  const groupedByClient = useMemo(() => {
    const groups = new Map();
    devices.forEach((device) => {
      const clientId = resolveDeviceClientId(device) || "global";
      if (!groups.has(clientId)) {
        groups.set(clientId, []);
      }
      groups.get(clientId).push(device);
    });
    return Array.from(groups.entries()).map(([clientId, list]) => {
      const available = list.filter((item) => !item.vehicleId).length;
      const linked = list.filter((item) => item.vehicleId).length;
      return {
        clientId,
        name:
          (clientId === "global" ? "EURO ONE" : null) ||
          clientNameById.get(String(clientId)) ||
          list.map((item) => resolveDeviceClientName(item)).find(Boolean) ||
          `Cliente ${String(clientId).slice(0, 6)}`,
        available,
        linked,
      };
    });
  }, [clientNameById, devices, resolveDeviceClientId, resolveDeviceClientName]);

  const detailsClient = useMemo(
    () => groupedByClient.find((client) => String(client.clientId) === String(detailsClientId)) || null,
    [detailsClientId, groupedByClient],
  );

  const detailsDevices = useMemo(
    () => devices.filter((device) => String(resolveDeviceClientId(device) || "global") === String(detailsClientId)),
    [detailsClientId, devices, resolveDeviceClientId],
  );

  const detailsFilteredDevices = useMemo(() => {
    const term = normalizeText(detailsSearch);
    return detailsDevices.filter((device) => {
      if (detailsTab === "linked" && !device.vehicleId) return false;
      if (detailsTab === "available" && device.vehicleId) return false;
      if (!term) return true;
      const modelLabel = modelById.get(device.modelId)?.name || device.model || "";
      const technicianRef = resolveDeviceTechnicianReference(device);
      const technicianName =
        technicianRef.name || (technicianRef.id ? technicianById.get(String(technicianRef.id))?.name : null) || "";
      const haystack = [
        device.uniqueId,
        device.id,
        modelLabel,
        device.vehicle?.plate,
        device.vehicleId,
        technicianName,
        resolveDeviceAddress(device),
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value))
        .join(" ");
      return haystack.includes(term);
    });
  }, [detailsDevices, detailsSearch, detailsTab, modelById, technicianById]);

  const filteredClients = useMemo(() => {
    const term = searchClient.trim().toLowerCase();
    return groupedByClient.filter((client) => {
      if (!term) return true;
      return client.name.toLowerCase().includes(term);
    });
  }, [groupedByClient, searchClient]);

  const filteredDevicesBase = useMemo(() => {
    const term = normalizeText(generalFilters.deviceId);
    const addressTerm = normalizeText(
      generalFilters.address?.label ||
        generalFilters.address?.concise ||
        generalFilters.address?.address ||
        "",
    );
    return devices.filter((device) => {
      const deviceModelId = String(device.modelId || device.attributes?.modelId || "");
      if (generalFilters.availability === "available" && device.vehicleId) return false;
      if (generalFilters.availability === "linked" && !device.vehicleId) return false;
      if (generalFilters.clientId && String(resolveDeviceClientId(device) || "") !== String(generalFilters.clientId)) {
        return false;
      }
      if (generalFilters.modelId && String(generalFilters.modelId) !== deviceModelId) return false;
      if (term && !normalizeText(resolveEquipmentDisplayCode(device)).includes(term)) return false;
      if (addressTerm && !normalizeText(resolveDeviceAddress(device)).includes(addressTerm)) return false;
      return true;
    });
  }, [devices, generalFilters, resolveDeviceClientId]);

  const conditionCounts = useMemo(() => {
    const counts = { all: filteredDevicesBase.length, novo: 0, usado_funcionando: 0, usado_defeito: 0 };
    filteredDevicesBase.forEach((device) => {
      const condition = resolveDeviceCondition(device);
      if (condition === "usado_funcionando") counts.usado_funcionando += 1;
      else if (condition === "usado_defeito") counts.usado_defeito += 1;
      else counts.novo += 1;
    });
    return counts;
  }, [filteredDevicesBase]);

  const filteredDevices = useMemo(() => {
    if (conditionFilter === "all") return filteredDevicesBase;
    return filteredDevicesBase.filter((device) => resolveDeviceCondition(device) === conditionFilter);
  }, [conditionFilter, filteredDevicesBase]);

  const effectiveGeneralPageSize = Math.max(1, Number(generalPageSize) || 20);
  const totalGeneralPages = Math.max(1, Math.ceil(filteredDevices.length / effectiveGeneralPageSize));
  const pagedGeneralDevices = useMemo(() => {
    const start = (generalPage - 1) * effectiveGeneralPageSize;
    return filteredDevices.slice(start, start + effectiveGeneralPageSize);
  }, [effectiveGeneralPageSize, filteredDevices, generalPage]);

  useEffect(() => {
    setGeneralPage(1);
  }, [effectiveGeneralPageSize, filteredDevices.length]);

  const transferSourceClientId = useMemo(
    () =>
      String(
        (
          isAdminGeneral
            ? (transferForm.sourceClientId || transferFilters.clientId || adminGeneralClientId || fallbackHomeClientId || "")
            : (resolvedClientId || fallbackHomeClientId || "")
        ) || "",
      ).trim(),
    [
      adminGeneralClientId,
      fallbackHomeClientId,
      isAdminGeneral,
      resolvedClientId,
      transferFilters.clientId,
      transferForm.sourceClientId,
    ],
  );

  const inferredTransferSourceClientId = useMemo(() => {
    if (!selectedIds.size) return "";
    const sourceClientIds = new Set();
    Array.from(selectedIds).forEach((id) => {
      const device = deviceById.get(String(id));
      const clientId = String(resolveDeviceClientId(device) || "").trim();
      if (clientId) sourceClientIds.add(clientId);
    });
    if (sourceClientIds.size !== 1) return "";
    return Array.from(sourceClientIds)[0];
  }, [deviceById, resolveDeviceClientId, selectedIds]);

  const transferFilteredBase = useMemo(() => {
    const idTerm = normalizeText(transferFilters.deviceId);
    const addressTerm = normalizeText(
      transferFilters.address?.label ||
        transferFilters.address?.concise ||
        transferFilters.address?.address ||
        "",
    );
    return devices.filter((device) => {
      const deviceModelId = String(device.modelId || device.attributes?.modelId || "");
      const modelLabel = modelById.get(device.modelId)?.name || device.model || "";
      const deviceClientId = String(resolveDeviceClientId(device) || "").trim();

      if (device.vehicleId) return false;
      if (transferSourceClientId && deviceClientId !== transferSourceClientId) return false;
      if (transferFilters.clientId && deviceClientId !== String(transferFilters.clientId)) return false;
      if (transferFilters.modelId && String(transferFilters.modelId) !== deviceModelId) return false;
      if (idTerm) {
        const idHaystack = [device.uniqueId, device.id, modelLabel].map((value) => normalizeText(value)).join(" ");
        if (!idHaystack.includes(idTerm)) return false;
      }
      if (addressTerm && !normalizeText(resolveDeviceAddress(device)).includes(addressTerm)) return false;
      return true;
    });
  }, [devices, modelById, resolveDeviceClientId, transferFilters, transferSourceClientId]);

  const transferConditionCounts = useMemo(() => {
    const counts = { all: transferFilteredBase.length, novo: 0, usado_funcionando: 0, usado_defeito: 0 };
    transferFilteredBase.forEach((device) => {
      const condition = resolveDeviceCondition(device);
      if (condition === "usado_funcionando") counts.usado_funcionando += 1;
      else if (condition === "usado_defeito") counts.usado_defeito += 1;
      else counts.novo += 1;
    });
    return counts;
  }, [transferFilteredBase]);

  const transferCandidates = useMemo(() => {
    if (transferConditionFilter === "all") return transferFilteredBase;
    return transferFilteredBase.filter((device) => resolveDeviceCondition(device) === transferConditionFilter);
  }, [transferConditionFilter, transferFilteredBase]);

  const transferKitSourceClientId = useMemo(() => {
    const candidate = String(
      (
        isAdminGeneral
          ? (transferForm.sourceClientId || inferredTransferSourceClientId || transferFilters.clientId || adminGeneralClientId || fallbackHomeClientId || "")
          : (resolvedClientId || inferredTransferSourceClientId || fallbackHomeClientId || "")
      ) || "",
    ).trim();
    if (!candidate || candidate.toLowerCase() === GLOBAL_KIT_CLIENT_ID) {
      return "";
    }
    return candidate;
  }, [
    adminGeneralClientId,
    fallbackHomeClientId,
    inferredTransferSourceClientId,
    isAdminGeneral,
    resolvedClientId,
    transferFilters.clientId,
    transferForm.sourceClientId,
  ]);

  useEffect(() => {
    if (!transferDrawerOpen || transferSelectionMode !== TRANSFER_SELECTION_MODES.KIT) return;
    if (!transferKitSourceClientId) {
      setTransferKits([]);
      setTransferKitsLoading(false);
      return;
    }
    let cancelled = false;
    setTransferKitsLoading(true);
    CoreApi.listKits({ clientId: transferKitSourceClientId })
      .then((loaded) => {
        if (cancelled) return;
        setTransferKits(Array.isArray(loaded) ? loaded : []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Falha ao carregar kits para transferência", error);
        setTransferKits([]);
      })
      .finally(() => {
        if (!cancelled) {
          setTransferKitsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [transferDrawerOpen, transferKitSourceClientId, transferSelectionMode]);

  useEffect(() => {
    if (!transferDrawerOpen) return;
    setTransferKitId((prev) => {
      if (!prev) return "";
      const exists = transferKits.some((kit) => String(kit?.id || "") === String(prev));
      return exists ? prev : "";
    });
  }, [transferDrawerOpen, transferKits]);

  const selectedTransferKit = useMemo(
    () => transferKits.find((kit) => String(kit?.id || "") === String(transferKitId || "")) || null,
    [transferKitId, transferKits],
  );

  const filteredTransferKits = useMemo(() => {
    const term = normalizeText(transferKitSearch);
    return transferKits.filter((kit) => {
      if (!term) return true;
      const clientId = kit?.clientId ? String(kit.clientId) : "";
      const clientLabel =
        kit?.clientName ||
        (clientId ? clientNameById.get(clientId) || `Cliente ${clientId.slice(0, 6)}` : "EURO ONE");
      const haystack = [
        kit?.code,
        kit?.name,
        kit?.modelName,
        kit?.modelCode,
        clientLabel,
        kit?.id,
      ]
        .filter(Boolean)
        .map((value) => normalizeText(value))
        .join(" ");
      return haystack.includes(term);
    });
  }, [clientNameById, transferKitSearch, transferKits]);

  const transferKitOptions = useMemo(() => {
    const options = filteredTransferKits.map((kit) => {
      const clientId = kit?.clientId ? String(kit.clientId) : "";
      const clientLabel =
        kit?.clientName ||
        (clientId ? clientNameById.get(clientId) || `Cliente ${clientId.slice(0, 6)}` : "EURO ONE");
      const availableCount = Number(kit?.availableCount || 0);
      const linkedCount = Number(kit?.linkedCount || 0);
      return {
        value: String(kit.id),
        label: `${kit.code || "Kit"} · ${kit.name || kit.modelName || "Sem nome"}`,
        description: `${clientLabel} · Disponíveis ${availableCount} · Vinculados ${linkedCount}`,
      };
    });
    if (
      selectedTransferKit?.id &&
      !options.some((option) => String(option.value) === String(selectedTransferKit.id))
    ) {
      const selectedAvailableCount = Number(selectedTransferKit?.availableCount || 0);
      const selectedLinkedCount = Number(selectedTransferKit?.linkedCount || 0);
      options.unshift({
        value: String(selectedTransferKit.id),
        label: `${selectedTransferKit.code || "Kit"} · ${
          selectedTransferKit.name || selectedTransferKit.modelName || "Sem nome"
        }`,
        description: `Disponíveis ${selectedAvailableCount} · Vinculados ${selectedLinkedCount}`,
      });
    }
    return options;
  }, [clientNameById, filteredTransferKits, selectedTransferKit]);

  const transferSelectedKitDeviceIds = useMemo(() => {
    if (!selectedTransferKit) return [];
    const equipments = Array.isArray(selectedTransferKit.equipments) ? selectedTransferKit.equipments : [];
    const idsFromEquipments = equipments.reduce((acc, entry) => {
      const id = String(entry?.id || "").trim();
      if (!id) return acc;
      if (entry?.vehicleId) return acc;
      const status = normalizeText(entry?.status);
      if (status === "transferido") return acc;
      acc.push(id);
      return acc;
    }, []);
    if (idsFromEquipments.length) {
      return Array.from(new Set(idsFromEquipments));
    }
    const fallbackIds = Array.isArray(selectedTransferKit.equipmentIds) ? selectedTransferKit.equipmentIds : [];
    return Array.from(
      new Set(
        fallbackIds
          .map((id) => String(id || "").trim())
          .filter(Boolean)
          .filter((id) => {
            const device = deviceById.get(String(id));
            return Boolean(device && !device.vehicleId);
          }),
      ),
    );
  }, [deviceById, selectedTransferKit]);

  const transferSelectedKitBlockedCount = useMemo(() => {
    if (!selectedTransferKit) return 0;
    const totalCount = Number(
      selectedTransferKit.equipmentCount ||
        (Array.isArray(selectedTransferKit.equipmentIds) ? selectedTransferKit.equipmentIds.length : 0),
    );
    const transferable = transferSelectedKitDeviceIds.length;
    return Math.max(0, totalCount - transferable);
  }, [selectedTransferKit, transferSelectedKitDeviceIds]);

  const transferSelectedDeviceIds = useMemo(() => {
    if (transferSelectionMode === TRANSFER_SELECTION_MODES.KIT) {
      return transferSelectedKitDeviceIds;
    }
    return Array.from(selectedIds).map((id) => String(id));
  }, [selectedIds, transferSelectedKitDeviceIds, transferSelectionMode]);

  const transferAttachedCount = transferSelectedDeviceIds.length;

  const nearbyDevices = useMemo(() => {
    if (!regionTarget) return [];
    const radiusValue = Number(radiusKm) || 0;
    if (!radiusValue) return [];
    return devices.filter((device) => {
      const coords = resolveDeviceCoords(device);
      if (!coords) return false;
      return distanceKm(regionTarget.lat, regionTarget.lng, coords.lat, coords.lng) <= radiusValue;
    });
  }, [devices, radiusKm, regionTarget]);

  const regionCountIcon = useMemo(() => {
    if (!regionTarget) return null;
    return L.divIcon({
      html: `<div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-xs font-semibold text-black shadow-lg">${nearbyDevices.length}</div>`,
      className: "region-count-marker",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  }, [nearbyDevices.length, regionTarget]);

  useEffect(() => {
    if (!map || !regionTarget) return;
    map.setView([regionTarget.lat, regionTarget.lng], 12, { animate: true });
  }, [map, regionTarget]);

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const removeTransferDevice = (id) => {
    if (!id) return;
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleOpenTransfer = () => {
    const rawSourceClientId = String(
      (
        isAdminGeneral
          ? (inferredTransferSourceClientId || resolvedClientId || adminGeneralClientId || fallbackHomeClientId || "")
          : (resolvedClientId || inferredTransferSourceClientId || fallbackHomeClientId || "")
      ) || "",
    ).trim();
    const defaultSourceClientId =
      rawSourceClientId.toLowerCase() === GLOBAL_KIT_CLIENT_ID ? "" : rawSourceClientId;
    const rawDestinationClientId = String(
      (isAdminGeneral ? (adminGeneralClientId || resolvedClientId || "") : defaultSourceClientId) || "",
    ).trim();
    const defaultDestinationClientId =
      rawDestinationClientId.toLowerCase() === GLOBAL_KIT_CLIENT_ID ? "" : rawDestinationClientId;
    const defaultDestinationType = isAdminGeneral
      ? TRANSFER_DESTINATION_OPTIONS_ADMIN.some((option) => option.value === transferForm.destinationType)
        ? transferForm.destinationType
        : TRANSFER_DESTINATION_TYPES.CLIENT
      : TRANSFER_DESTINATION_OPTIONS_CLIENT.some((option) => option.value === transferForm.destinationType)
        ? transferForm.destinationType
        : TRANSFER_DESTINATION_TYPES.TECHNICIAN;
    setTransferForm((prev) => ({
      ...prev,
      sourceClientId: defaultSourceClientId,
      destinationClientId: defaultDestinationClientId,
      destinationTechnicianId: "",
      destinationType: defaultDestinationType,
      ownershipType: "COMODATO",
      city: "",
      state: "",
      address: "",
      referencePoint: "",
      latitude: "",
      longitude: "",
      notes: "",
    }));
    setTransferAddressValue({ formattedAddress: "" });
    setTransferAddressResetKey((prev) => prev + 1);
    setTransferFilters({
      clientId: isAdminGeneral ? defaultSourceClientId : (resolvedClientId || fallbackHomeClientId || ""),
      deviceId: "",
      modelId: "",
      address: null,
    });
    setTransferSelectionMode(TRANSFER_SELECTION_MODES.EQUIPMENTS);
    setTransferKitId("");
    setTransferKitSearch("");
    setTransferKits([]);
    setTransferKitsLoading(false);
    setTransferConditionFilter("all");
    setTransferDrawerOpen(true);
  };

  const handleTransfer = async () => {
    if (transferSubmitting) return;
    if (transferSelectionMode === TRANSFER_SELECTION_MODES.KIT && !transferKitId) {
      showToast("Selecione um kit para transferir.", "warning");
      return;
    }
    const transferDeviceIds = Array.from(
      new Set(
        transferSelectedDeviceIds
          .map((id) => String(id || "").trim())
          .filter(Boolean),
      ),
    );
    if (!transferDeviceIds.length) {
      showToast(
        transferSelectionMode === TRANSFER_SELECTION_MODES.KIT
          ? "O kit selecionado não possui equipamentos disponíveis para transferência."
          : "Selecione equipamentos para transferir.",
        "warning",
      );
      return;
    }

    const inferredSourceClientIds = new Set();
    transferDeviceIds.forEach((id) => {
      const device = deviceById.get(String(id));
      const clientId = String(resolveDeviceClientId(device) || "").trim();
      if (!clientId || clientId.toLowerCase() === GLOBAL_KIT_CLIENT_ID) return;
      inferredSourceClientIds.add(clientId);
    });
    const inferredSourceClientIdFromPayload =
      inferredSourceClientIds.size === 1 ? Array.from(inferredSourceClientIds)[0] : "";
    const inferredSourceClientIdFromKit =
      transferSelectionMode === TRANSFER_SELECTION_MODES.KIT
        ? String(selectedTransferKit?.clientId || "").trim()
        : "";
    const inferredSourceClientId =
      inferredSourceClientIdFromPayload ||
      (inferredSourceClientIdFromKit &&
      inferredSourceClientIdFromKit.toLowerCase() !== GLOBAL_KIT_CLIENT_ID
        ? inferredSourceClientIdFromKit
        : "");

    const explicitSourceClientId = isAdminGeneral
      ? String(transferForm.sourceClientId || transferFilters.clientId || "").trim()
      : String(resolvedClientId || fallbackHomeClientId || "").trim();
    const sourceClientId = String(
      (
        explicitSourceClientId ||
        inferredSourceClientId ||
        transferKitSourceClientId ||
        transferSourceClientId ||
        (isAdminGeneral
          ? (adminGeneralClientId || fallbackHomeClientId || "")
          : (resolvedClientId || fallbackHomeClientId || ""))
      ) || "",
    ).trim();
    if (
      isAdminGeneral &&
      !explicitSourceClientId &&
      sourceClientId &&
      String(transferForm.sourceClientId || "").trim() !== sourceClientId
    ) {
      setTransferForm((prev) => ({ ...prev, sourceClientId }));
    }
    if (!sourceClientId || sourceClientId.toLowerCase() === GLOBAL_KIT_CLIENT_ID) {
      showToast("Selecione o cliente de origem.", "warning");
      return;
    }

    const destinationOptions = isAdminGeneral ? TRANSFER_DESTINATION_OPTIONS_ADMIN : TRANSFER_DESTINATION_OPTIONS_CLIENT;
    const destinationType = destinationOptions.some((option) => option.value === transferForm.destinationType)
      ? transferForm.destinationType
      : TRANSFER_DESTINATION_TYPES.TECHNICIAN;
    const isBaseEuroDestination =
      destinationType === TRANSFER_DESTINATION_TYPES.BASE_RETURN ||
      destinationType === TRANSFER_DESTINATION_TYPES.BASE_MAINTENANCE;
    const destinationClientId = isBaseEuroDestination
      ? ""
      : isAdminGeneral
        ? String(transferForm.destinationClientId || "").trim()
        : sourceClientId;

    if (
      isTransferToClient(destinationType) &&
      (!destinationClientId || destinationClientId.toLowerCase() === GLOBAL_KIT_CLIENT_ID)
    ) {
      showToast("Selecione o cliente destino.", "warning");
      return;
    }

    if (isTransferToTechnician(destinationType) && !transferForm.destinationTechnicianId) {
      showToast("Selecione o técnico destino.", "warning");
      return;
    }

    const locationCity = String(transferForm.city || "").trim();
    const locationState = String(transferForm.state || "").trim();
    if (!locationCity || !locationState) {
      showToast("Informe Cidade e UF para concluir a transferência.", "warning");
      return;
    }

    const destinationTechnician = technicianById.get(String(transferForm.destinationTechnicianId || ""));
    const transferCount = transferDeviceIds.length;
    setTransferSubmitting(true);
    try {
      showToast(`Transferindo ${transferCount} equipamentos...`, "info");
      await CoreApi.transferStockDevices({
        deviceIds: transferDeviceIds,
        sourceClientId,
        destinationType,
        destinationClientId:
          destinationType === TRANSFER_DESTINATION_TYPES.TECHNICIAN
            ? destinationClientId || sourceClientId
            : destinationClientId || "",
        destinationTechnicianId: isTransferToTechnician(destinationType) ? transferForm.destinationTechnicianId || "" : "",
        destinationTechnicianName: isTransferToTechnician(destinationType) ? destinationTechnician?.name || "" : "",
        locationCity,
        locationState,
        locationAddress: transferForm.address || "",
        address: transferForm.address || "",
        referencePoint: transferForm.referencePoint || "",
        latitude: transferForm.latitude ?? "",
        longitude: transferForm.longitude ?? "",
        notes: transferForm.notes || "",
        ownershipType: normalizeOwnershipTypeValue(transferForm.ownershipType),
      });

      clearApiCaches();
      await Promise.all([loadStock(), loadKitStock()]);
      setSelectedIds(new Set());
      setTransferKitId("");
      setTransferDrawerOpen(false);
      showToast(`Transferência concluída: ${transferCount} equipamento(s).`, "success");
    } catch (error) {
      console.error("Falha ao transferir equipamentos", error);
      showToast(resolveRequestErrorMessage(error, "Falha ao transferir equipamentos."), "error");
    } finally {
      setTransferSubmitting(false);
    }
  };

  useEffect(() => {
    if (!transferDrawerOpen || transferSelectionMode !== TRANSFER_SELECTION_MODES.EQUIPMENTS) return;
    const allowedIds = new Set(transferCandidates.map((device) => String(device.id)));
    setSelectedIds((prev) => {
      const kept = Array.from(prev).filter((id) => allowedIds.has(String(id)));
      if (kept.length === prev.size) return prev;
      return new Set(kept);
    });
  }, [transferCandidates, transferDrawerOpen, transferSelectionMode]);

  useEffect(() => {
    if (!transferDrawerOpen || isAdminGeneral) return;
    setTransferForm((prev) => {
      const lockedClientId = String(resolvedClientId || fallbackHomeClientId || "");
      const nextDestinationType = TRANSFER_DESTINATION_OPTIONS_CLIENT.some(
        (option) => option.value === prev.destinationType,
      )
        ? prev.destinationType
        : TRANSFER_DESTINATION_TYPES.TECHNICIAN;
      const next = {
        ...prev,
        sourceClientId: lockedClientId,
        destinationClientId: lockedClientId,
        destinationType: nextDestinationType,
      };
      if (
        next.sourceClientId === prev.sourceClientId &&
        next.destinationClientId === prev.destinationClientId &&
        next.destinationType === prev.destinationType
      ) {
        return prev;
      }
      return next;
    });
  }, [fallbackHomeClientId, isAdminGeneral, resolvedClientId, transferDrawerOpen]);

  useEffect(() => {
    if (!transferDrawerOpen) return;
    const effectiveTransferSourceClientId = transferSourceClientId || inferredTransferSourceClientId;
    if (!effectiveTransferSourceClientId) return;
    if (isAdminGeneral && !String(transferForm.sourceClientId || "").trim()) {
      setTransferForm((prev) => ({ ...prev, sourceClientId: effectiveTransferSourceClientId }));
    }
    setTransferFilters((prev) => {
      const nextClientId = isAdminGeneral ? effectiveTransferSourceClientId : (resolvedClientId || fallbackHomeClientId || "");
      if (String(prev.clientId || "") === String(nextClientId || "")) return prev;
      return { ...prev, clientId: nextClientId };
    });
  }, [
    fallbackHomeClientId,
    inferredTransferSourceClientId,
    isAdminGeneral,
    resolvedClientId,
    transferDrawerOpen,
    transferForm.sourceClientId,
    transferSourceClientId,
  ]);

  const handleSelectRegion = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setMapAddressValue(nextValue);
    if (!Number.isFinite(nextValue.lat) || !Number.isFinite(nextValue.lng)) {
      setRegionTarget(null);
      return;
    }
    setRegionTarget({
      lat: nextValue.lat,
      lng: nextValue.lng,
      label: nextValue.formattedAddress || "Local encontrado",
    });
  };

  const handleSelectTransferAddress = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setTransferAddressValue(nextValue);
    setTransferForm((prev) => ({
      ...prev,
      address: nextValue.formattedAddress || "",
      city: nextValue.city || prev.city,
      state: nextValue.state || prev.state,
      latitude: nextValue.lat ?? "",
      longitude: nextValue.lng ?? "",
    }));
  };

  const handleApplyGeneralFilters = useCallback(() => {
    setGeneralFilters((prev) => ({
      ...prev,
      clientId: draftFilters.clientId,
      deviceId: draftFilters.deviceId,
      modelId: draftFilters.modelId,
      availability: draftFilters.availability,
      address: generalAddressSelection,
    }));
    setGeneralPage(1);
  }, [draftFilters, generalAddressSelection]);

  useEffect(() => {
    setGeneralPage(1);
  }, [conditionFilter, generalFilters]);

  const selectedDevicesList = useMemo(
    () => transferSelectedDeviceIds.map((id) => deviceById.get(String(id))).filter(Boolean),
    [deviceById, transferSelectedDeviceIds],
  );

  const filteredKitDevices = useMemo(() => {
    const term = normalizeText(kitSearch);
    const scopedDevices = shouldUseGlobalKitDevices
      ? devices
      : effectiveKitClientId
        ? devices.filter((device) => String(resolveDeviceClientId(device) || "") === String(effectiveKitClientId))
        : [];
    return scopedDevices.filter((device) => {
      if (!term) return true;
      const modelLabel = modelById.get(device.modelId)?.name || device.model || "";
      const haystack = [device.uniqueId, device.id, modelLabel, resolveDeviceClientName(device)]
        .filter(Boolean)
        .map((value) => normalizeText(value))
        .join(" ");
      return haystack.includes(term);
    });
  }, [devices, effectiveKitClientId, kitSearch, modelById, resolveDeviceClientId, resolveDeviceClientName, shouldUseGlobalKitDevices]);

  const resolveKitClientName = useCallback(
    (kit) => {
      if (kit?.clientName) return String(kit.clientName);
      const clientId = kit?.clientId ? String(kit.clientId) : null;
      if (clientId && clientNameById.has(clientId)) return clientNameById.get(clientId);
      if (!clientId || clientId === GLOBAL_KIT_CLIENT_ID) return "EURO ONE";
      return `Cliente ${clientId.slice(0, 6)}`;
    },
    [clientNameById],
  );

  const filteredKitStockItems = useMemo(() => {
    return kitStockItems.filter((kit) => {
      const condition = normalizeKitCondition(kit?.condition);
      if (kitStockCondition !== "all" && condition !== kitStockCondition) {
        return false;
      }
      return true;
    });
  }, [kitStockCondition, kitStockItems]);

  const kitDetailsConditionOptions = useMemo(() => {
    const map = new Map();
    kitDetailsItems.forEach((item) => {
      const rawCondition = item?.condition || item?.conditionLabel || item?.conditionGroup;
      const conditionKey = normalizeKitItemCondition(rawCondition);
      if (!conditionKey) return;
      map.set(conditionKey, item?.conditionLabel || formatKitItemConditionLabel(rawCondition));
    });
    const preferredOrder = ["novo", "usado", "usado_funcionando", "usado_defeito", "manutencao"];
    const orderedOptions = preferredOrder
      .filter((key) => map.has(key))
      .map((key) => ({ value: key, label: map.get(key) || formatKitItemConditionLabel(key) }));
    const customOptions = Array.from(map.entries())
      .filter(([key]) => !preferredOrder.includes(key))
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
    const options = [{ value: "all", label: "Todos" }, ...orderedOptions, ...customOptions];
    if (kitDetailsCondition !== "all" && !options.some((option) => option.value === kitDetailsCondition)) {
      options.push({ value: kitDetailsCondition, label: formatKitItemConditionLabel(kitDetailsCondition) });
    }
    return options;
  }, [kitDetailsCondition, kitDetailsItems]);

  const filteredKitDetailsItems = useMemo(() => {
    const term = normalizeText(kitDetailsSearch);
    return kitDetailsItems.filter((item) => {
      const rawCondition = item?.conditionGroup || item?.condition || item?.conditionLabel;
      if (kitStockCondition !== "all" && resolveKitItemConditionBucket(rawCondition) !== kitStockCondition) {
        return false;
      }
      if (kitDetailsCondition !== "all" && normalizeKitItemCondition(rawCondition) !== kitDetailsCondition) {
        return false;
      }
      if (!term) return true;
      const equipmentId = resolveEquipmentDisplayCode(item) || "";
      return normalizeText(equipmentId).includes(term);
    });
  }, [kitDetailsCondition, kitDetailsItems, kitDetailsSearch, kitStockCondition]);

  useEffect(() => {
    const nextDrafts = {};
    kitDetailsItems.forEach((item) => {
      const key = resolveKitDetailItemKey(item);
      if (!key) return;
      nextDrafts[key] = item?.observation || item?.note || "";
    });
    setKitDetailsObservationDrafts(nextDrafts);
    setKitDetailsSavingObservation({});
  }, [kitDetailsItems]);

  const handleOpenKitDetails = useCallback(
    async (kit) => {
      if (!kit?.id) return;
      const fallbackItems = Array.isArray(kit?.equipments) ? kit.equipments : [];
      setSelectedKitDetails(kit);
      setKitDetailsItems(fallbackItems);
      setKitDetailsSearch("");
      setKitDetailsCondition(kitStockCondition !== "all" ? kitStockCondition : "all");
      setKitDetailsError("");
      setKitDetailsDrawerOpen(true);
      setKitDetailsLoading(true);
      try {
        const scopedClientId = hasAdminAccess
          ? String(kit?.clientId || kitStockClientId || "").trim()
          : String(resolvedClientId || "").trim();
        const params = scopedClientId ? { clientId: scopedClientId } : undefined;
        const details = await CoreApi.getKitDetails(kit.id, params);
        const item = details?.item || null;
        const items = Array.isArray(details?.items)
          ? details.items
          : Array.isArray(item?.equipments)
            ? item.equipments
            : fallbackItems;
        setSelectedKitDetails(item || kit);
        setKitDetailsItems(items);
      } catch (error) {
        console.error("Falha ao carregar detalhes do kit", error);
        setKitDetailsError("Não foi possível carregar os detalhes do kit.");
      } finally {
        setKitDetailsLoading(false);
      }
    },
    [hasAdminAccess, kitStockClientId, kitStockCondition, resolvedClientId],
  );

  const handleSaveKitItemObservation = useCallback(
    async (item) => {
      const kitId = selectedKitDetails?.id ? String(selectedKitDetails.id) : "";
      if (!kitId) return;
      const equipmentId = resolveKitDetailItemKey(item);
      if (!equipmentId) return;
      const draftValue = kitDetailsObservationDrafts[equipmentId] ?? "";
      const scopedClientId = hasAdminAccess
        ? String(selectedKitDetails?.clientId || kitStockClientId || "").trim()
        : String(resolvedClientId || "").trim();
      const payload = {
        observation: String(draftValue || "").trim() || null,
        ...(scopedClientId ? { clientId: scopedClientId } : {}),
      };

      setKitDetailsSavingObservation((prev) => ({ ...prev, [equipmentId]: true }));
      try {
        const response = await CoreApi.updateKitItemObservation(kitId, equipmentId, payload);
        const updatedItem = response?.item || null;
        if (updatedItem) {
          setKitDetailsItems((prev) =>
            prev.map((entry) => {
              if (resolveKitDetailItemKey(entry) !== equipmentId) return entry;
              return { ...entry, ...updatedItem };
            }),
          );
        } else {
          setKitDetailsItems((prev) =>
            prev.map((entry) => {
              if (resolveKitDetailItemKey(entry) !== equipmentId) return entry;
              return {
                ...entry,
                observation: payload.observation,
                note: payload.observation,
              };
            }),
          );
        }
        showToast("Observação atualizada com sucesso.", "success");
      } catch (error) {
        console.error("Falha ao atualizar observação do item do kit", error);
        showToast(error?.message || "Falha ao salvar observação.", "error");
      } finally {
        setKitDetailsSavingObservation((prev) => ({ ...prev, [equipmentId]: false }));
      }
    },
    [
      hasAdminAccess,
      kitDetailsObservationDrafts,
      kitStockClientId,
      resolvedClientId,
      selectedKitDetails?.clientId,
      selectedKitDetails?.id,
      showToast,
    ],
  );

  const handleCloseKitDetails = useCallback(() => {
    setKitDetailsDrawerOpen(false);
    setKitDetailsLoading(false);
    setKitDetailsError("");
    setSelectedKitDetails(null);
    setKitDetailsItems([]);
    setKitDetailsSearch("");
    setKitDetailsCondition("all");
    setKitDetailsObservationDrafts({});
    setKitDetailsSavingObservation({});
  }, []);

  useEffect(() => {
    if (!isTransferToTechnician(transferForm.destinationType)) {
      return;
    }
    const technician = technicianOptions.find(
      (option) => String(option.id) === String(transferForm.destinationTechnicianId),
    );
    if (!technician) return;
    const resolvedAddress = resolveTechnicianAddress(technician);
    setTransferForm((prev) => ({
      ...prev,
      city: technician.city || prev.city,
      state: technician.state || prev.state,
      address: resolvedAddress || prev.address,
      latitude: technician.latitude ?? prev.latitude,
      longitude: technician.longitude ?? prev.longitude,
    }));
    setTransferAddressValue({ formattedAddress: resolvedAddress || "" });
  }, [technicianOptions, transferForm.destinationTechnicianId, transferForm.destinationType]);

  useEffect(() => {
    if (isTransferToTechnician(transferForm.destinationType)) return;
    const clientId = String(
      (transferForm.destinationClientId || transferForm.sourceClientId || transferSourceClientId || "") || "",
    ).trim();
    if (!clientId) return;
    const destinationClient = transferClientById.get(clientId);
    if (!destinationClient) return;
    setTransferForm((prev) => ({
      ...prev,
      city: prev.city || destinationClient.city || "",
      state: prev.state || destinationClient.state || "",
      address: prev.address || destinationClient.address || "",
    }));
  }, [
    transferClientById,
    transferForm.destinationClientId,
    transferForm.destinationType,
    transferForm.sourceClientId,
    transferSourceClientId,
  ]);

  const handleDeleteDevice = async (device) => {
    if (!device?.id) return;
    if (!isAdminGeneral) return;
    await confirmDelete({
      title: "Excluir equipamento",
      message: `Tem certeza que deseja excluir o equipamento ${resolveEquipmentDisplayCode(device) || "código não cadastrado"}? Essa ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        try {
          await api.delete(`${API_ROUTES.core.devices}/${device.id}`);
          setDevices((prev) => prev.filter((entry) => String(entry.id) !== String(device.id)));
          showToast("Excluído com sucesso.");
        } catch (requestError) {
          showToast("Falha ao excluir.", "error");
          throw requestError;
        }
      },
    });
  };

  const toggleKitEquipment = (deviceId) => {
    setKitDraft((prev) => {
      const current = new Set(Array.isArray(prev.equipmentIds) ? prev.equipmentIds.map(String) : []);
      const key = String(deviceId);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, equipmentIds: Array.from(current) };
    });
  };

  const handleCreateKitModel = async () => {
    if (!canManageKitModels) {
      showToast("Seu perfil pode apenas usar modelos de kit existentes.", "warning");
      return;
    }
    if (!effectiveKitClientId) {
      showToast("Selecione um cliente para criar modelo de kit.", "error");
      return;
    }
    const name = String(kitModelForm.name || "").trim();
    const code = String(kitModelForm.code || "").trim();
    setSavingKit(true);
    try {
      await CoreApi.createKitModel({
        clientId: effectiveKitClientId,
        name: name || undefined,
        code: code || undefined,
      });
      setKitModelForm({ name: "", code: "" });
      await Promise.all([loadStock(), loadKitStock()]);
      showToast("Modelo de kit criado com sucesso.", "success");
    } catch (error) {
      showToast(error?.message || "Falha ao criar modelo de kit.", "error");
    } finally {
      setSavingKit(false);
    }
  };

  const handleRenameKitModel = async (modelId) => {
    if (!canManageKitModels) {
      showToast("Seu perfil pode apenas usar modelos de kit existentes.", "warning");
      return;
    }
    if (isGlobalKitClient) {
      showToast("Selecione um cliente específico para editar o modelo.", "error");
      return;
    }
    if (!effectiveKitClientId) {
      showToast("Selecione um cliente para atualizar o modelo de kit.", "error");
      return;
    }
    const nextName = String(kitModelDrafts[String(modelId)] || "").trim();
    if (!nextName) {
      showToast("Informe um nome para o modelo de kit.", "error");
      return;
    }
    setSavingKit(true);
    try {
      await CoreApi.updateKitModel(modelId, {
        clientId: effectiveKitClientId,
        name: nextName,
      });
      await Promise.all([loadStock(), loadKitStock()]);
      showToast("Modelo de kit atualizado.", "success");
    } catch (error) {
      showToast(error?.message || "Falha ao atualizar modelo de kit.", "error");
    } finally {
      setSavingKit(false);
    }
  };

  const handleCreateKit = async () => {
    if (isGlobalKitClient) {
      showToast("Selecione um cliente específico para criar kit.", "error");
      return;
    }
    if (!effectiveKitClientId) {
      showToast("Selecione um cliente para criar kit.", "error");
      return;
    }
    if (!kitDraft.modelId) {
      showToast("Selecione o modelo do kit.", "error");
      return;
    }
    if (!Array.isArray(kitDraft.equipmentIds) || kitDraft.equipmentIds.length === 0) {
      showToast("Selecione ao menos um equipamento para o kit.", "error");
      return;
    }
    setSavingKit(true);
    try {
      await CoreApi.createKit({
        clientId: effectiveKitClientId,
        modelId: kitDraft.modelId,
        name: String(kitDraft.name || "").trim() || undefined,
        equipmentIds: kitDraft.equipmentIds,
      });
      setKitDraft({ modelId: "", name: "", equipmentIds: [] });
      setKitSearch("");
      await Promise.all([loadStock(), loadKitStock()]);
      showToast("Kit criado com sucesso.", "success");
    } catch (error) {
      showToast(error?.message || "Falha ao criar kit.", "error");
    } finally {
      setSavingKit(false);
    }
  };

  const technicianModelOptions = useMemo(() => {
    const map = new Map();
    (Array.isArray(technicianStockRows) ? technicianStockRows : []).forEach((item) => {
      const modelId = String(item?.modelId || "").trim();
      if (!modelId || map.has(modelId)) return;
      map.set(modelId, {
        value: modelId,
        label: item?.modelName || `Modelo ${modelId}`,
      });
    });
    return Array.from(map.values());
  }, [technicianStockRows]);

  const technicianGroupedByClient = useMemo(() => {
    const groups = new Map();
    (Array.isArray(technicianStockRows) ? technicianStockRows : []).forEach((item) => {
      const key = String(item?.clientId || "global");
      if (!groups.has(key)) {
        groups.set(key, {
          clientId: key,
          name: item?.clientName || "EURO ONE",
          available: 0,
          linked: 0,
          total: 0,
        });
      }
      const current = groups.get(key);
      current.total += 1;
      if (item?.availability === "linked") {
        current.linked += 1;
      } else {
        current.available += 1;
      }
    });
    return Array.from(groups.values()).sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
  }, [technicianStockRows]);

  const filteredTechnicianClients = useMemo(() => {
    const term = normalizeText(searchClient);
    if (!term) return technicianGroupedByClient;
    return technicianGroupedByClient.filter((client) => normalizeText(client?.name).includes(term));
  }, [searchClient, technicianGroupedByClient]);

  const technicianTableMode = useMemo(() => {
    if (generalFilters.availability === "linked") return "linked";
    if (generalFilters.availability === "available") return "available";
    return "both";
  }, [generalFilters.availability]);

  const effectiveTechnicianPageSize = Math.max(1, Number(generalPageSize) || 20);
  const totalTechnicianPages = Math.max(1, Math.ceil(technicianStockRows.length / effectiveTechnicianPageSize));
  const pagedTechnicianRows = useMemo(() => {
    const start = (generalPage - 1) * effectiveTechnicianPageSize;
    return technicianStockRows.slice(start, start + effectiveTechnicianPageSize);
  }, [effectiveTechnicianPageSize, generalPage, technicianStockRows]);

  const technicianColSpan = technicianTableMode === "linked" ? 7 : technicianTableMode === "available" ? 5 : 9;

  if (isTechnician) {
    return (
      <div className="flex min-h-[calc(100vh-72px)] flex-col gap-4">
        <PageHeader
          actions={
            <button
              type="button"
              onClick={() => {
                void Promise.all([loadTechnicianStock(), loadKitStock()]);
              }}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
          }
        />

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setView("geral")}
            className={`rounded-xl px-4 py-2 ${view === "geral" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Geral
          </button>
          <button
            type="button"
            onClick={() => setView("cliente")}
            className={`rounded-xl px-4 py-2 ${view === "cliente" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Cliente
          </button>
          <button
            type="button"
            onClick={() => setView("kits")}
            className={`rounded-xl px-4 py-2 ${view === "kits" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
          >
            Kit
          </button>
        </div>

        {view === "geral" && (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <AutocompleteSelect
                label="Cliente"
                placeholder={hasAdminAccess || isTechnician ? "Todos os clientes" : "Cliente atual"}
                value={draftFilters.clientId}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
                options={clientAutocompleteOptions}
                loadOptions={loadClientOptions}
                allowClear={hasAdminAccess || isTechnician}
                disabled={false}
                className="min-w-[220px] flex-1"
              />
              <div className="min-w-[200px] flex-1">
                <span className="block text-xs uppercase tracking-wide text-white/60">ID do equipamento</span>
                <input
                  value={draftFilters.deviceId}
                  onChange={(event) => setDraftFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
                  placeholder="Buscar equipamento por ID"
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                />
              </div>
              <AutocompleteSelect
                label="Modelo"
                placeholder="Todos os modelos"
                value={draftFilters.modelId}
                onChange={(value) => setDraftFilters((prev) => ({ ...prev, modelId: String(value || "") }))}
                options={technicianModelOptions}
                allowClear
                className="min-w-[220px] flex-1"
              />
              <div className="min-w-[240px] flex-1">
                <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
                <div className="mt-2">
                  <AddressAutocomplete
                    key={generalAddressResetKey}
                    label={null}
                    placeholder="Buscar endereço"
                    onSelect={(option) => setGeneralAddressSelection(option)}
                    onClear={() => setGeneralAddressSelection(null)}
                    variant="toolbar"
                    containerClassName="w-full"
                    portalSuggestions
                  />
                </div>
              </div>
              <div className="min-w-[180px] flex-1">
                <span className="block text-xs uppercase tracking-wide text-white/60">Vínculo</span>
                <select
                  value={draftFilters.availability}
                  onChange={(event) => setDraftFilters((prev) => ({ ...prev, availability: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={handleApplyGeneralFilters}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              >
                Aplicar
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col pb-4">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <DataTable className="flex-1 min-h-0 overflow-auto border border-white/10">
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                    <tr className="text-left">
                      {technicianTableMode === "linked" && (
                        <>
                          <th className="px-4 py-3">Data último serviço</th>
                          <th className="px-4 py-3">Cliente</th>
                          <th className="px-4 py-3">ID do Equipamento</th>
                          <th className="px-4 py-3">Placa</th>
                          <th className="px-4 py-3">OS</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Localização</th>
                        </>
                      )}
                      {technicianTableMode === "available" && (
                        <>
                          <th className="px-4 py-3">Cliente</th>
                          <th className="px-4 py-3">Modelo</th>
                          <th className="px-4 py-3">ID do Equipamento</th>
                          <th className="px-4 py-3">Data transferido</th>
                          <th className="px-4 py-3">Quem enviou</th>
                        </>
                      )}
                      {technicianTableMode === "both" && (
                        <>
                          <th className="px-4 py-3">Data último serviço</th>
                          <th className="px-4 py-3">Cliente</th>
                          <th className="px-4 py-3">Modelo</th>
                          <th className="px-4 py-3">ID do Equipamento</th>
                          <th className="px-4 py-3">Vínculo</th>
                          <th className="px-4 py-3">Placa</th>
                          <th className="px-4 py-3">OS</th>
                          <th className="px-4 py-3">Data transferido</th>
                          <th className="px-4 py-3">Quem enviou</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {technicianStockLoading && (
                      <tr>
                        <td colSpan={technicianColSpan} className="px-4 py-6">
                          <SkeletonTable rows={6} columns={technicianColSpan} />
                        </td>
                      </tr>
                    )}
                    {!technicianStockLoading && technicianStockRows.length === 0 && (
                      <tr>
                        <td colSpan={technicianColSpan} className="px-4 py-8">
                          <EmptyState title="Nenhum equipamento encontrado no escopo do técnico." />
                        </td>
                      </tr>
                    )}
                    {!technicianStockLoading &&
                      pagedTechnicianRows.map((item) => (
                        <tr key={item.id} className="hover:bg-white/5">
                          {technicianTableMode === "linked" && (
                            <>
                              <td className="px-4 py-3 text-white/70">{formatKitLinkedAtValue(item.lastServiceDate)}</td>
                              <td className="px-4 py-3 text-white/80">{item.clientName || "—"}</td>
                              <td className="px-4 py-3 text-white">{item.equipmentId || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.plate || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.osNumber || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.status || "—"}</td>
                              <td className="px-4 py-3 text-white/60">{item.location || "—"}</td>
                            </>
                          )}
                          {technicianTableMode === "available" && (
                            <>
                              <td className="px-4 py-3 text-white/80">{item.clientName || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.modelName || "—"}</td>
                              <td className="px-4 py-3 text-white">{item.equipmentId || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{formatKitLinkedAtValue(item.transferDate)}</td>
                              <td className="px-4 py-3 text-white/70">{item.sentByName || "—"}</td>
                            </>
                          )}
                          {technicianTableMode === "both" && (
                            <>
                              <td className="px-4 py-3 text-white/70">{formatKitLinkedAtValue(item.lastServiceDate)}</td>
                              <td className="px-4 py-3 text-white/80">{item.clientName || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.modelName || "—"}</td>
                              <td className="px-4 py-3 text-white">{item.equipmentId || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.status || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.plate || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{item.osNumber || "—"}</td>
                              <td className="px-4 py-3 text-white/70">{formatKitLinkedAtValue(item.transferDate)}</td>
                              <td className="px-4 py-3 text-white/70">{item.sentByName || "—"}</td>
                            </>
                          )}
                        </tr>
                      ))}
                  </tbody>
                </DataTable>
                {technicianStockRows.length > 0 && (
                  <DataTablePagination
                    className="mt-auto"
                    pageSize={generalPageSize}
                    pageSizeOptions={PAGE_SIZE_OPTIONS}
                    onPageSizeChange={(value) => {
                      setGeneralPageSize(Number(value));
                      setGeneralPage(1);
                    }}
                    currentPage={generalPage}
                    totalPages={totalTechnicianPages}
                    totalItems={technicianStockRows.length}
                    onPageChange={(nextPage) => setGeneralPage(nextPage)}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {view === "cliente" && (
          <div className="space-y-4">
            <FilterBar
              left={
                <div className="flex w-full flex-wrap items-center gap-3">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                    <input
                      value={searchClient}
                      onChange={(event) => setSearchClient(event.target.value)}
                      placeholder="Buscar lista/cliente"
                      className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                    />
                  </div>
                </div>
              }
            />
            <DataTable>
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr className="text-left">
                  <th className="px-4 py-3">Lista</th>
                  <th className="px-4 py-3">Disponíveis</th>
                  <th className="px-4 py-3">Vinculados</th>
                  <th className="px-4 py-3">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {technicianStockLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6">
                      <SkeletonTable rows={6} columns={4} />
                    </td>
                  </tr>
                )}
                {!technicianStockLoading && filteredTechnicianClients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8">
                      <EmptyState title="Nenhuma lista encontrada." subtitle="Ajuste os filtros para visualizar o estoque." />
                    </td>
                  </tr>
                )}
                {!technicianStockLoading &&
                  filteredTechnicianClients.map((client) => (
                    <tr key={client.clientId} className="hover:bg-white/5">
                      <td className="px-4 py-3 text-white">{client.name}</td>
                      <td className="px-4 py-3 text-white/70">{client.available}</td>
                      <td className="px-4 py-3 text-white/70">{client.linked}</td>
                      <td className="px-4 py-3 text-white/70">{client.total}</td>
                    </tr>
                  ))}
              </tbody>
            </DataTable>
          </div>
        )}

        {view === "kits" && (
          <div className="space-y-4 rounded-none border border-white/10 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,220px)_1fr] lg:items-end">
              <div>
                <span className="block text-xs uppercase tracking-wide text-white/60">Condição</span>
                <select
                  value={kitStockCondition}
                  onChange={(event) => setKitStockCondition(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {KIT_CONDITION_FILTERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-white/60">Estoque Kit no mesmo padrão visual do módulo de estoque.</div>
            </div>

            <div className="overflow-hidden rounded-none border border-white/10">
              <DataTable>
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                  <tr className="text-left">
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Modelo</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Condição</th>
                    <th className="px-3 py-2">Qtd. disponível</th>
                    <th className="px-3 py-2">Qtd. vinculada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10 text-sm">
                  {kitStockLoading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6">
                        <SkeletonTable rows={6} columns={6} />
                      </td>
                    </tr>
                  )}
                  {!kitStockLoading &&
                    filteredKitStockItems.map((kit) => {
                      const condition = normalizeKitCondition(kit.condition);
                      const availableCount =
                        kit.availableCount ?? Math.max(0, Number(kit.equipmentCount || 0) - Number(kit.linkedCount || 0));
                      return (
                        <tr key={`${kit.clientId || "global"}:${kit.id}`} className="hover:bg-white/5">
                          <td className="px-3 py-2 text-white">{kit.code || "—"}</td>
                          <td className="px-3 py-2 text-white/80">{kit.modelName || "—"}</td>
                          <td className="px-3 py-2 text-white/70">{resolveKitClientName(kit)}</td>
                          <td className="px-3 py-2 text-white/70">{condition === "novo" ? "Novo" : "Usado"}</td>
                          <td className="px-3 py-2 text-white/70">{availableCount}</td>
                          <td className="px-3 py-2 text-white/70">{kit.linkedCount ?? 0}</td>
                        </tr>
                      );
                    })}
                  {!kitStockLoading && !filteredKitStockItems.length && (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-white/50">
                        Nenhum kit encontrado para os filtros.
                      </td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </div>
          </div>
        )}
        <PageToast toast={toast} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-72px)] flex-col gap-4">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void Promise.all([loadStock(), loadKitStock()]);
              }}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
            <button
              type="button"
              onClick={handleOpenTransfer}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              <span className="inline-flex items-center gap-2">
                <Send className="h-4 w-4" />
                Transferir
              </span>
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setView("geral")}
          className={`rounded-xl px-4 py-2 ${view === "geral" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
        >
          Geral
        </button>
        <button
          type="button"
          onClick={() => setView("cliente")}
          className={`rounded-xl px-4 py-2 ${view === "cliente" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
        >
          Cliente
        </button>
        <button
          type="button"
          onClick={() => setView("mapa")}
          className={`rounded-xl px-4 py-2 ${view === "mapa" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
        >
          Mapa/Região
        </button>
        <button
          type="button"
          onClick={() => setView("kits")}
          className={`rounded-xl px-4 py-2 ${view === "kits" ? "bg-sky-500 text-black" : "bg-white/10 text-white"}`}
        >
          Kit
        </button>
      </div>

      {view === "geral" && (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {CONDITION_FILTERS.map((option) => {
              const isActive = conditionFilter === option.value;
              const count =
                option.value === "all"
                  ? conditionCounts.all
                  : option.value === "novo"
                    ? conditionCounts.novo
                    : option.value === "usado_funcionando"
                      ? conditionCounts.usado_funcionando
                      : conditionCounts.usado_defeito;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setConditionFilter(option.value)}
                  className={`rounded-full px-4 py-2 text-xs uppercase tracking-wide transition ${
                    isActive ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {option.label}: {count}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <AutocompleteSelect
              label="Cliente"
              placeholder={hasAdminAccess ? "Todos os clientes" : "Cliente atual"}
              value={draftFilters.clientId}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
              options={clientAutocompleteOptions}
              loadOptions={loadClientOptions}
              allowClear={hasAdminAccess}
              disabled={!hasAdminAccess}
              className="min-w-[220px] flex-1"
            />
            <div className="min-w-[200px] flex-1">
              <span className="block text-xs uppercase tracking-wide text-white/60">ID do equipamento</span>
              <input
                value={draftFilters.deviceId}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
                placeholder="Buscar equipamento por ID"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <AutocompleteSelect
              label="Modelo"
              placeholder="Todos os modelos"
              value={draftFilters.modelId}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, modelId: String(value || "") }))}
              options={models.map((model) => ({
                value: String(model.id),
                label: model.name || model.model || model.id,
              }))}
              allowClear
              className="min-w-[220px] flex-1"
            />
            <div className="min-w-[240px] flex-1">
              <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
              <div className="mt-2">
                <AddressAutocomplete
                  key={generalAddressResetKey}
                  label={null}
                  placeholder="Buscar endereço"
                  onSelect={(option) => setGeneralAddressSelection(option)}
                  onClear={() => setGeneralAddressSelection(null)}
                  variant="toolbar"
                  containerClassName="w-full"
                  portalSuggestions
                />
              </div>
            </div>
            <div className="min-w-[180px] flex-1">
              <span className="block text-xs uppercase tracking-wide text-white/60">Vínculo</span>
              <select
                value={draftFilters.availability}
                onChange={(event) => setDraftFilters((prev) => ({ ...prev, availability: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleApplyGeneralFilters}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Aplicar
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col pb-4">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <DataTable className="flex-1 min-h-0 overflow-auto border border-white/10">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                  <tr className="text-left">
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Modelo</th>
                    <th className="px-4 py-3">Cliente</th>
                    <th className="px-4 py-3">Condição</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Localização</th>
                    <th className="px-4 py-3">Técnico</th>
                    <th className="px-4 py-3">Vínculo</th>
                    <th className="px-4 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {loading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-6">
                        <SkeletonTable rows={6} columns={9} />
                      </td>
                    </tr>
                  )}
                  {!loading && filteredDevices.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8">
                        <EmptyState title="Nenhum equipamento encontrado." subtitle="Refine os filtros para o estoque." />
                      </td>
                    </tr>
                  )}
                  {!loading &&
                    pagedGeneralDevices.map((device) => {
                      const location = resolveStockLocationLabel(device);
                      const technicianRef = resolveDeviceTechnicianReference(device);
                      const technicianName =
                        technicianRef.name ||
                        (technicianRef.id ? technicianById.get(String(technicianRef.id))?.name : null) ||
                        "";
                      const technicianLabel = !device.vehicleId && technicianName ? technicianName : "—";
                      const condition = resolveDeviceCondition(device);
                      return (
                        <tr key={device.id} className="hover:bg-white/5">
                          <td className="px-4 py-3 text-white/80">{resolveEquipmentDisplayCode(device) || "—"}</td>
                          <td className="px-4 py-3 text-white/70">
                            {modelById.get(device.modelId)?.name || device.model || "—"}
                          </td>
                          <td className="px-4 py-3 text-white/70">
                            {resolveDeviceClientName(device)}
                          </td>
                          <td className="px-4 py-3 text-white/70">{formatConditionLabel(condition)}</td>
                          <td className="px-4 py-3">
                            <span className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80">
                              {device.vehicleId ? "Vinculado" : "Disponível"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-white/70">{location}</td>
                          <td className="px-4 py-3 text-white/70">{technicianLabel}</td>
                          <td className="px-4 py-3 text-white/70">
                            {device.vehicle?.plate || device.vehicleId || "—"}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {stockPermission.isFull && isAdminGeneral ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteDevice(device)}
                                className="rounded-lg border border-red-500/40 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                              >
                                Excluir
                              </button>
                            ) : (
                              <span className="text-xs text-white/50">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </DataTable>
              {filteredDevices.length > 0 && (
                <DataTablePagination
                  className="mt-auto"
                  pageSize={generalPageSize}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onPageSizeChange={(value) => {
                    setGeneralPageSize(Number(value));
                    setGeneralPage(1);
                  }}
                  currentPage={generalPage}
                  totalPages={totalGeneralPages}
                  totalItems={filteredDevices.length}
                  onPageChange={(nextPage) => setGeneralPage(nextPage)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {view === "cliente" && (
        <div className="space-y-4">
          <FilterBar
            left={
              <div className="flex w-full flex-wrap items-center gap-3">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
                  <input
                    value={searchClient}
                    onChange={(event) => setSearchClient(event.target.value)}
                    placeholder="Buscar lista/cliente"
                    className="w-full rounded-xl border border-white/10 bg-black/30 py-2 pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
              </div>
            }
          />
          <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Lista</th>
                <th className="px-4 py-3">Disponíveis</th>
                <th className="px-4 py-3">Vinculados</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {loading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6">
                    <SkeletonTable rows={6} columns={4} />
                  </td>
                </tr>
              )}
              {!loading && filteredClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8">
                    <EmptyState title="Nenhuma lista encontrada." subtitle="Ajuste os filtros para visualizar o estoque." />
                  </td>
                </tr>
              )}
              {!loading &&
                filteredClients.map((client) => (
                  <tr key={client.clientId} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-white/40" />
                        <span>{client.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/70">{client.available}</td>
                    <td className="px-4 py-3 text-white/70">{client.linked}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setDetailsClientId(client.clientId);
                          setDetailsTab("linked");
                          setDetailsSearch("");
                          setDetailsDrawerOpen(true);
                        }}
                        className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </div>
      )}

      {view === "kits" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
            {canManageKitModels ? (
              <button
                type="button"
                onClick={() => setKitSubview("modelo")}
                className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  kitSubview === "modelo"
                    ? "border border-primary/40 bg-primary/20 text-white"
                    : "border border-white/10 text-white/70 hover:text-white"
                }`}
              >
                Modelo
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setKitSubview("kit")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                kitSubview === "kit"
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-white/10 text-white/70 hover:text-white"
              }`}
            >
              Kit
            </button>
            <button
              type="button"
              onClick={() => setKitSubview("estoque-kit")}
              className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                kitSubview === "estoque-kit"
                  ? "border border-primary/40 bg-primary/20 text-white"
                  : "border border-white/10 text-white/70 hover:text-white"
              }`}
            >
              Estoque Kit
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,320px)_1fr] lg:items-end">
            <AutocompleteSelect
              label="Cliente"
              placeholder={hasAdminAccess ? "Selecione o cliente" : "Cliente atual"}
              value={hasAdminAccess ? kitClientId : effectiveKitClientId}
              onChange={(value) => setKitClientId(String(value || kitEuroOneOptionValue || ""))}
              options={kitClientAutocompleteOptions}
              loadOptions={loadKitClientOptions}
              allowClear={hasAdminAccess}
              disabled={!hasAdminAccess}
            />
            <div className="text-xs text-white/60">
              {isKitClientReady
                ? "Gerenciando kits do cliente selecionado."
                : "Selecione um cliente para gerenciar kits específicos."}
            </div>
          </div>

          {!isKitClientReady && (
            <div className="rounded-none border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              Selecione um cliente para gerenciar modelos e kits.
            </div>
          )}

          {isKitClientReady && !canManageKitModels && (
            <div className="rounded-none border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-sm text-sky-100">
              Seu perfil pode apenas selecionar modelos de kit já cadastrados.
            </div>
          )}

          {canManageKitModels && isKitClientReady && kitSubview === "modelo" && (
            <div className="rounded-none border border-white/10 p-4">
              <h2 className="text-sm font-semibold text-white">Modelos de Kit</h2>
              <p className="mt-1 text-xs text-white/60">
                Cadastre os modelos padrão e renomeie quando necessário.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
                <input
                  value={kitModelForm.name}
                  onChange={(event) => setKitModelForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Nome do modelo (ex.: EURO MODELO 4)"
                  className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                />
                <input
                  value={kitModelForm.code}
                  onChange={(event) => setKitModelForm((prev) => ({ ...prev, code: event.target.value }))}
                  placeholder="Código 2 dígitos (opcional)"
                  className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={handleCreateKitModel}
                  disabled={savingKit}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
                >
                  Adicionar
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {kitModels.map((model) => (
                  <div
                    key={model.id}
                    className="grid gap-2 rounded-none border border-white/10 p-3 md:grid-cols-[70px_1fr_auto]"
                  >
                    <div className="rounded-none border border-white/10 bg-white/10 px-2 py-2 text-center text-xs font-semibold text-white/80">
                      {model.code || "--"}
                    </div>
                    <input
                      value={kitModelDrafts[String(model.id)] || ""}
                      onChange={(event) =>
                        setKitModelDrafts((prev) => ({ ...prev, [String(model.id)]: event.target.value }))
                      }
                      className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleRenameKitModel(model.id)}
                      disabled={savingKit}
                      className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white transition hover:bg-white/15 disabled:opacity-60"
                    >
                      Salvar
                    </button>
                  </div>
                ))}
                {!kitModels.length && (
                  <div className="rounded-none border border-white/10 px-3 py-4 text-sm text-white/60">
                    Nenhum modelo de kit encontrado.
                  </div>
                )}
              </div>
            </div>
          )}

          {isKitClientReady && kitSubview === "kit" && (
            <div className="rounded-none border border-white/10 p-4">
              <h2 className="text-sm font-semibold text-white">Criar Kit</h2>
              <p className="mt-1 text-xs text-white/60">
                Selecione um modelo e vincule vários equipamentos ao kit.
              </p>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <AutocompleteSelect
                  label="Modelo do kit"
                  placeholder="Selecione o modelo"
                  value={kitDraft.modelId}
                  onChange={(value) => setKitDraft((prev) => ({ ...prev, modelId: String(value || "") }))}
                  options={kitModelOptions}
                  allowClear
                />
                <div>
                  <span className="block text-xs uppercase tracking-wide text-white/60">Nome do kit (opcional)</span>
                  <input
                    value={kitDraft.name}
                    onChange={(event) => setKitDraft((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="Ex.: Kit instalação padrão"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                  />
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <span className="block text-xs uppercase tracking-wide text-white/60">Equipamentos do kit</span>
                <input
                  value={kitSearch}
                  onChange={(event) => setKitSearch(event.target.value)}
                  placeholder="Buscar equipamento por ID/modelo/cliente"
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
                />
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-none border border-white/10 p-2">
                  {filteredKitDevices.map((device) => {
                    const key = String(device.id);
                    const checked = kitDraft.equipmentIds.includes(key);
                    const modelLabel = modelById.get(device.modelId)?.name || device.model || "Modelo";
                    return (
                      <label key={device.id} className="flex items-center justify-between gap-3 rounded-none px-2 py-1 hover:bg-white/5">
                        <span className="flex items-center gap-2 text-sm text-white/80">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleKitEquipment(device.id)}
                            className="h-4 w-4 rounded border-white/30 bg-transparent"
                          />
                          {resolveEquipmentDisplayCode(device) || "—"}
                        </span>
                        <span className="text-xs text-white/50">{modelLabel}</span>
                      </label>
                    );
                  })}
                  {!filteredKitDevices.length && (
                    <div className="px-2 py-3 text-sm text-white/50">Nenhum equipamento encontrado.</div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-xs text-white/60">
                  {kitDraft.equipmentIds.length} equipamentos selecionados
                </span>
                <button
                  type="button"
                  onClick={handleCreateKit}
                  disabled={savingKit || !kitDraft.modelId || !kitDraft.equipmentIds.length}
                  className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
                >
                  Criar kit
                </button>
              </div>
            </div>
          )}

          {kitSubview === "estoque-kit" && (
            <div className="space-y-4 rounded-none border border-white/10 p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,220px)_1fr] lg:items-end">
                <AutocompleteSelect
                  label="Cliente"
                  placeholder="Selecione o cliente"
                  value={kitStockClientId}
                  onChange={(value) => setKitStockClientId(String(value || GLOBAL_KIT_CLIENT_ID))}
                  options={kitStockClientAutocompleteOptions}
                  loadOptions={loadKitStockClientOptions}
                  allowClear={hasAdminAccess}
                  disabled={!hasAdminAccess}
                />
                <div>
                  <span className="block text-xs uppercase tracking-wide text-white/60">Condição</span>
                  <select
                    value={kitStockCondition}
                    onChange={(event) => setKitStockCondition(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  >
                    {KIT_CONDITION_FILTERS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-white/60">
                  {kitStockClientId ? "Listando kits do cliente selecionado." : "Selecione um cliente para listar kits."}
                </div>
              </div>

              <div className="overflow-hidden rounded-none border border-white/10">
                <DataTable>
                  <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                    <tr className="text-left">
                      <th className="px-3 py-2">Código</th>
                      <th className="px-3 py-2">Modelo</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Condição</th>
                      <th className="px-3 py-2">Qtd. disponível</th>
                      <th className="px-3 py-2">Qtd. vinculada</th>
                      <th className="px-3 py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10 text-sm">
                    {kitStockLoading && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6">
                          <SkeletonTable rows={6} columns={7} />
                        </td>
                      </tr>
                    )}
                    {!kitStockLoading &&
                      filteredKitStockItems.map((kit) => {
                        const condition = normalizeKitCondition(kit.condition);
                        const availableCount =
                          kit.availableCount ?? Math.max(0, Number(kit.equipmentCount || 0) - Number(kit.linkedCount || 0));
                        return (
                          <tr key={`${kit.clientId || "global"}:${kit.id}`} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white">{kit.code || "—"}</td>
                            <td className="px-3 py-2 text-white/80">{kit.modelName || "—"}</td>
                            <td className="px-3 py-2 text-white/70">{resolveKitClientName(kit)}</td>
                            <td className="px-3 py-2 text-white/70">{condition === "novo" ? "Novo" : "Usado"}</td>
                            <td className="px-3 py-2 text-white/70">{availableCount}</td>
                            <td className="px-3 py-2 text-white/70">{kit.linkedCount ?? 0}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  void handleOpenKitDetails(kit);
                                }}
                                className="rounded-lg border border-white/10 bg-white/10 px-3 py-1 text-xs text-white transition hover:bg-white/15"
                              >
                                Detalhes do Kit
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    {!kitStockLoading && !filteredKitStockItems.length && (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-white/50">
                          Nenhum kit encontrado para os filtros.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </DataTable>
              </div>
            </div>
          )}
        </div>
      )}

      <Drawer
        open={kitDetailsDrawerOpen}
        onClose={handleCloseKitDetails}
        title={`Detalhes do Kit ${selectedKitDetails?.code || "—"}`}
        description={selectedKitDetails?.modelName || "Equipamentos vinculados ao kit selecionado."}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-white/50">Cliente</div>
                <div className="text-white">{resolveKitClientName(selectedKitDetails)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-white/50">Modelo</div>
                <div className="text-white">{selectedKitDetails?.modelName || "—"}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-white/50">Qtd. equipamentos</div>
                <div className="text-white">{selectedKitDetails?.equipmentCount ?? kitDetailsItems.length}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-white/50">Condição do kit</div>
                <div className="text-white">{formatKitItemConditionLabel(selectedKitDetails?.condition || "novo")}</div>
              </div>
            </div>
          </div>

          {kitDetailsError ? (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {kitDetailsError}
            </div>
          ) : null}

          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <div>
              <span className="block text-xs uppercase tracking-wide text-white/60">Condição</span>
              <select
                value={kitDetailsCondition}
                onChange={(event) => setKitDetailsCondition(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {kitDetailsConditionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wide text-white/60">Buscar por ID</span>
              <input
                value={kitDetailsSearch}
                onChange={(event) => setKitDetailsSearch(event.target.value)}
                placeholder="Código cadastrado"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-white/10">
            <DataTable>
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr className="text-left">
                  <th className="px-3 py-2">ID do equipamento</th>
                  <th className="px-3 py-2">Modelo</th>
                  <th className="px-3 py-2">Condição</th>
                  <th className="px-3 py-2">Status no kit</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Data/Hora vinculação</th>
                  <th className="px-3 py-2">Observação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 text-sm">
                {kitDetailsLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6">
                      <SkeletonTable rows={6} columns={7} />
                    </td>
                  </tr>
                )}
                {!kitDetailsLoading && kitDetailsItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-white/50">
                      Nenhum equipamento vinculado a este kit.
                    </td>
                  </tr>
                )}
                {!kitDetailsLoading && kitDetailsItems.length > 0 && !filteredKitDetailsItems.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-white/50">
                      Nenhum equipamento encontrado para os filtros.
                    </td>
                  </tr>
                )}
                {!kitDetailsLoading &&
                  filteredKitDetailsItems.map((item) => {
                    const itemKey = resolveKitDetailItemKey(item);
                    const rawCondition = item?.conditionLabel || item?.condition || item?.conditionGroup;
                    const modelLabel = item?.modelName || modelById.get(item?.modelId)?.name || "—";
                    const clientLabel = item?.clientName || resolveKitClientName(selectedKitDetails);
                    const isSavingObservation = Boolean(kitDetailsSavingObservation[itemKey]);
                    return (
                      <tr key={`${selectedKitDetails?.id || "kit"}:${itemKey || "item"}`}>
                        <td className="px-3 py-2 text-white">{resolveEquipmentDisplayCode(item) || "Código não cadastrado"}</td>
                        <td className="px-3 py-2 text-white/80">{modelLabel}</td>
                        <td className="px-3 py-2 text-white/70">{formatKitItemConditionLabel(rawCondition)}</td>
                        <td className="px-3 py-2 text-white/70">{item?.status || "—"}</td>
                        <td className="px-3 py-2 text-white/70">{clientLabel || "—"}</td>
                        <td className="px-3 py-2 text-white/70">{formatKitLinkedAtValue(item?.linkedAt)}</td>
                        <td className="px-3 py-2 text-white/70">
                          <div className="flex min-w-[220px] items-center gap-2">
                            <input
                              value={kitDetailsObservationDrafts[itemKey] ?? ""}
                              onChange={(event) =>
                                setKitDetailsObservationDrafts((prev) => ({
                                  ...prev,
                                  [itemKey]: event.target.value,
                                }))
                              }
                              placeholder="Sem observação"
                              className="w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                void handleSaveKitItemObservation(item);
                              }}
                              disabled={!itemKey || isSavingObservation}
                              className="rounded-lg border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isSavingObservation ? "Salvando..." : "Salvar"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </DataTable>
          </div>
        </div>
      </Drawer>

      {view === "mapa" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white">Busca por região</h2>
            <div className="flex flex-wrap gap-3">
              <AddressAutocomplete
                label={null}
                value={mapAddressValue}
                onChange={handleSelectRegion}
                onSelect={handleSelectRegion}
                placeholder="Buscar endereço"
                variant="toolbar"
                containerClassName="min-w-[260px] flex-1"
              />
              <input
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
                placeholder="Raio (km)"
                className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
              />
            </div>
            <div className="h-[360px] overflow-hidden rounded-xl border border-white/10">
              <MapContainer
                ref={mapRef}
                center={regionTarget ? [regionTarget.lat, regionTarget.lng] : DEFAULT_CENTER}
                zoom={regionTarget ? 12 : 4}
                style={{ height: "100%", width: "100%" }}
                whenReady={onMapReady}
              >
                <TileLayer url={tileUrl} attribution={tileAttribution} subdomains={tileSubdomains} maxZoom={tileMaxZoom} />
                {regionTarget && (
                  <>
                    <Marker
                      position={[regionTarget.lat, regionTarget.lng]}
                      icon={regionCountIcon || leafletDefaultIcon}
                    />
                    <Circle
                      center={[regionTarget.lat, regionTarget.lng]}
                      radius={(Number(radiusKm) || 0) * 1000}
                      pathOptions={{ color: "#38bdf8" }}
                    />
                  </>
                )}
                {nearbyDevices.map((device) => {
                  const coords = resolveDeviceCoords(device);
                  if (!coords) return null;
                  return <Marker key={device.id} position={[coords.lat, coords.lng]} icon={leafletDefaultIcon} />;
                })}
              </MapContainer>
            </div>
          </div>
          <DataTable>
              <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                <tr className="text-left">
                  <th className="px-4 py-3">Modelo</th>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {(regionTarget ? nearbyDevices : availableDevices).map((device) => (
                  <tr key={device.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white/80">
                      {modelById.get(device.modelId)?.name || device.model || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/80">{resolveEquipmentDisplayCode(device) || "—"}</td>
                    <td className="px-4 py-3 text-white/70">
                      {clientNameById.get(String(device.clientId)) || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70">{device.vehicleId ? "Vinculado" : "Disponível"}</td>
                  </tr>
                ))}
                {!availableDevices.length && !loading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8">
                      <EmptyState title="Nenhum equipamento disponível." subtitle="Tente outro raio/região." />
                    </td>
                  </tr>
                )}
              </tbody>
          </DataTable>
        </div>
      )}

      <Drawer
        open={detailsDrawerOpen}
        onClose={() => {
          setDetailsDrawerOpen(false);
          setDetailsClientId(null);
          setDetailsSearch("");
          setDetailsTab("linked");
        }}
        title={detailsClient?.name || "Detalhes do estoque"}
        description="Resumo do estoque e equipamentos vinculados."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.12em] text-white/50">Cliente</div>
                <div className="text-base text-white">{detailsClient?.name || "—"}</div>
              </div>
              <div className="text-right text-xs text-white/60">
                <div>Disponíveis: {detailsClient?.available ?? 0}</div>
                <div>Vinculados: {detailsClient?.linked ?? 0}</div>
              </div>
            </div>
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {[
                  { key: "linked", label: "Vinculados" },
                  { key: "available", label: "Disponíveis" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setDetailsTab(tab.key)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition ${
                      detailsTab === tab.key
                        ? "border border-primary/60 bg-primary/20 text-white"
                        : "border border-white/10 text-white/60 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <label className="min-w-0 flex-1 text-xs uppercase tracking-wide text-white/60 sm:min-w-[200px]">
                Buscar equipamento
                <input
                  value={detailsSearch}
                  onChange={(event) => setDetailsSearch(event.target.value)}
                  placeholder="Modelo, ID, placa ou técnico"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
                />
              </label>
            </div>

            <div className="e-scroll-x max-h-[50vh] overflow-y-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[760px] text-left text-xs text-white/70">
                <thead className="sticky top-0 bg-[#0f141c] text-[10px] uppercase tracking-wide text-white/50">
                  <tr>
                    <th className="px-3 py-2">Modelo</th>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Localização</th>
                    <th className="px-3 py-2">Técnico</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {detailsFilteredDevices.length ? (
                    detailsFilteredDevices.map((device) => {
                      const modelLabel = modelById.get(device.modelId)?.name || device.model || "—";
                      const location = resolveStockLocationLabel(device);
                      const technicianRef = resolveDeviceTechnicianReference(device);
                      const technicianName =
                        technicianRef.name ||
                        (technicianRef.id ? technicianById.get(String(technicianRef.id))?.name : null) ||
                        "";
                      const technicianLabel = !device.vehicleId && technicianName ? technicianName : "—";
                      return (
                        <tr key={device.id}>
                          <td className="px-3 py-2">{modelLabel}</td>
                          <td className="px-3 py-2">{resolveEquipmentDisplayCode(device) || "—"}</td>
                          <td className="px-3 py-2">{device.vehicleId ? "Vinculado" : "Disponível"}</td>
                          <td className="px-3 py-2">{location}</td>
                          <td className="px-3 py-2">{technicianLabel}</td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-white/50">
                        Nenhum equipamento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={transferDrawerOpen}
        onClose={() => setTransferDrawerOpen(false)}
        title="Transferir equipamentos"
        description="Selecione origem e destino da transferência e anexe endereço."
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-xs uppercase tracking-[0.12em] text-white/50">Origem e destino</div>
            <div className="grid gap-3 md:grid-cols-2">
              {isAdminGeneral ? (
                <AutocompleteSelect
                  label="Cliente origem"
                  placeholder="Selecione o cliente de origem"
                  value={transferForm.sourceClientId}
                  onChange={(value) =>
                    setTransferForm((prev) => ({
                      ...prev,
                      sourceClientId: value || "",
                    }))
                  }
                  options={transferClientAutocompleteOptions}
                  loadOptions={loadTransferClientOptions}
                  allowClear
                />
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80">
                  <div className="text-xs uppercase tracking-wide text-white/60">Cliente origem</div>
                  <div className="mt-2">
                    {clientNameById.get(String(resolvedClientId || "")) || clientNameById.get(String(transferSourceClientId || "")) || "EURO ONE"}
                  </div>
                </div>
              )}

              <label className="text-xs uppercase tracking-wide text-white/60">
                Destino
                <select
                  value={transferForm.destinationType}
                  onChange={(event) =>
                    setTransferForm((prev) => {
                      const nextType = event.target.value;
                      return {
                        ...prev,
                        destinationType: nextType,
                        destinationClientId: isTransferToClient(nextType) ? prev.destinationClientId : "",
                        destinationTechnicianId: isTransferToTechnician(nextType) ? prev.destinationTechnicianId : "",
                      };
                    })
                  }
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {(isAdminGeneral ? TRANSFER_DESTINATION_OPTIONS_ADMIN : TRANSFER_DESTINATION_OPTIONS_CLIENT).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {isTransferToClient(transferForm.destinationType) ? (
                <AutocompleteSelect
                  label="Cliente destino"
                  placeholder="Selecione o cliente destino"
                  value={transferForm.destinationClientId}
                  onChange={(value) => setTransferForm((prev) => ({ ...prev, destinationClientId: value || "" }))}
                  options={transferClientAutocompleteOptions}
                  loadOptions={loadTransferClientOptions}
                  allowClear
                />
              ) : null}

              {(transferForm.destinationType === TRANSFER_DESTINATION_TYPES.BASE_RETURN ||
                transferForm.destinationType === TRANSFER_DESTINATION_TYPES.BASE_MAINTENANCE) && (
                <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white/80">
                  <div className="text-xs uppercase tracking-wide text-white/60">Destino: Base Euro</div>
                  <div className="mt-2">
                    {transferForm.destinationType === TRANSFER_DESTINATION_TYPES.BASE_RETURN ? "Devolução" : "Manutenção"}
                  </div>
                </div>
              )}

              {isTransferToTechnician(transferForm.destinationType) && (
                <AutocompleteSelect
                  label="Técnico destino"
                  placeholder={techniciansLoading ? "Carregando técnicos..." : "Selecione o técnico"}
                  value={transferForm.destinationTechnicianId}
                  onChange={(value) => setTransferForm((prev) => ({ ...prev, destinationTechnicianId: value || "" }))}
                  options={technicianAutocompleteOptions}
                  loadOptions={loadTechnicianOptions}
                  allowClear
                  disabled={techniciansLoading}
                />
              )}

              <label className="text-xs uppercase tracking-wide text-white/60">
                Propriedade da transferência
                <select
                  value={normalizeOwnershipTypeValue(transferForm.ownershipType)}
                  onChange={(event) =>
                    setTransferForm((prev) => ({
                      ...prev,
                      ownershipType: normalizeOwnershipTypeValue(event.target.value),
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {TRANSFER_OWNERSHIP_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { value: TRANSFER_SELECTION_MODES.EQUIPMENTS, label: "Equipamentos" },
              { value: TRANSFER_SELECTION_MODES.KIT, label: "Kit" },
            ].map((option) => {
              const isActive = transferSelectionMode === option.value;
              return (
                <button
                  key={`transfer-selection-mode-${option.value}`}
                  type="button"
                  onClick={() => setTransferSelectionMode(option.value)}
                  className={`rounded-full px-4 py-2 text-xs uppercase tracking-wide transition ${
                    isActive ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {transferSelectionMode === TRANSFER_SELECTION_MODES.EQUIPMENTS ? (
            <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap gap-2">
                {CONDITION_FILTERS.map((option) => {
                  const isActive = transferConditionFilter === option.value;
                  const count =
                    option.value === "all"
                      ? transferConditionCounts.all
                      : option.value === "novo"
                        ? transferConditionCounts.novo
                        : option.value === "usado_funcionando"
                          ? transferConditionCounts.usado_funcionando
                          : transferConditionCounts.usado_defeito;
                  return (
                    <button
                      key={`transfer-condition-${option.value}`}
                      type="button"
                      onClick={() => setTransferConditionFilter(option.value)}
                      className={`rounded-full px-4 py-2 text-xs uppercase tracking-wide transition ${
                        isActive ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                      }`}
                    >
                      {option.label}: {count}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <AutocompleteSelect
                  label="Cliente"
                  placeholder={isAdminGeneral ? "Selecione o cliente" : "Cliente atual"}
                  value={transferFilters.clientId}
                  onChange={(value) => setTransferFilters((prev) => ({ ...prev, clientId: value || "" }))}
                  options={transferClientAutocompleteOptions}
                  loadOptions={loadTransferClientOptions}
                  allowClear={isAdminGeneral}
                  disabled={!isAdminGeneral}
                  className="min-w-[220px] flex-1"
                />
                <div className="min-w-[220px] flex-1">
                  <span className="block text-xs uppercase tracking-wide text-white/60">ID do equipamento</span>
                  <input
                    value={transferFilters.deviceId}
                    onChange={(event) => setTransferFilters((prev) => ({ ...prev, deviceId: event.target.value }))}
                    placeholder="Buscar equipamento por ID"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
                <AutocompleteSelect
                  label="Modelo"
                  placeholder="Todos os modelos"
                  value={transferFilters.modelId}
                  onChange={(value) => setTransferFilters((prev) => ({ ...prev, modelId: String(value || "") }))}
                  options={models.map((model) => ({
                    value: String(model.id),
                    label: model.name || model.model || model.id,
                  }))}
                  allowClear
                  className="min-w-[220px] flex-1"
                />
                <div className="min-w-[240px] flex-1">
                  <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
                  <div className="mt-2">
                    <AddressAutocomplete
                      key={transferAddressResetKey}
                      label={null}
                      placeholder="Buscar endereço"
                      onSelect={(option) => setTransferFilters((prev) => ({ ...prev, address: option || null }))}
                      onClear={() => setTransferFilters((prev) => ({ ...prev, address: null }))}
                      variant="toolbar"
                      containerClassName="w-full"
                      portalSuggestions
                    />
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <DataTable className="max-h-[38vh] flex-1 min-h-0 overflow-auto border border-white/10">
                    <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
                      <tr className="text-left">
                        <th className="px-4 py-3">Selecionar</th>
                        <th className="px-4 py-3">ID</th>
                        <th className="px-4 py-3">Modelo</th>
                        <th className="px-4 py-3">Cliente</th>
                        <th className="px-4 py-3">Condição</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Localização</th>
                        <th className="px-4 py-3">Vínculo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {!transferCandidates.length && (
                        <tr>
                          <td colSpan={8} className="px-4 py-8">
                            <EmptyState title="Nenhum equipamento encontrado." subtitle="Refine os filtros para transferência." />
                          </td>
                        </tr>
                      )}
                      {transferCandidates.map((device) => {
                        const isSelected = selectedIds.has(device.id);
                        const location = resolveDeviceAddress(device) || [device.city, device.state].filter(Boolean).join(" - ") || "Base";
                        const condition = resolveDeviceCondition(device);
                        const clientLabel = resolveDeviceClientName(device);
                        return (
                          <tr
                            key={`transfer-device-${device.id}`}
                            onClick={() => toggleSelection(device.id)}
                            className={`cursor-pointer hover:bg-white/5 ${isSelected ? "bg-sky-500/10" : ""}`}
                          >
                            <td className="px-4 py-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onClick={(event) => event.stopPropagation()}
                                onChange={() => toggleSelection(device.id)}
                                className="h-4 w-4 rounded border-white/30 bg-transparent"
                              />
                            </td>
                            <td className="px-4 py-3 text-white/80">{resolveEquipmentDisplayCode(device) || "—"}</td>
                            <td className="px-4 py-3 text-white/70">{modelById.get(device.modelId)?.name || device.model || "—"}</td>
                            <td className="px-4 py-3 text-white/70">{clientLabel}</td>
                            <td className="px-4 py-3 text-white/70">{formatConditionLabel(condition)}</td>
                            <td className="px-4 py-3 text-white/70">{device.vehicleId ? "Vinculado" : "Disponível"}</td>
                            <td className="px-4 py-3 text-white/70">{location}</td>
                            <td className="px-4 py-3 text-white/70">{device.vehicle?.plate || device.vehicleId || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <AutocompleteSelect
                  label="Kit"
                  placeholder={
                    transferKitSourceClientId
                      ? transferKitsLoading
                        ? "Carregando kits..."
                        : "Selecione o kit"
                      : "Selecione o cliente de origem"
                  }
                  value={transferKitId}
                  onChange={(value) => setTransferKitId(String(value || ""))}
                  options={transferKitOptions}
                  allowClear
                  disabled={!transferKitSourceClientId || transferKitsLoading}
                />
                <div>
                  <span className="block text-xs uppercase tracking-wide text-white/60">Buscar kit</span>
                  <input
                    value={transferKitSearch}
                    onChange={(event) => setTransferKitSearch(event.target.value)}
                    placeholder="Código, nome ou modelo"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
                  />
                </div>
              </div>

              {!transferKitSourceClientId ? (
                <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
                  Selecione o cliente de origem para listar os kits disponíveis.
                </div>
              ) : null}

              {transferKitsLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/60">
                  Carregando kits...
                </div>
              ) : null}

              {transferKitSourceClientId && !transferKitsLoading && !filteredTransferKits.length ? (
                <EmptyState title="Nenhum kit encontrado." subtitle="Ajuste a busca ou crie um kit para este cliente." />
              ) : null}

              {selectedTransferKit ? (
                <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/80">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-white">
                      {(selectedTransferKit.code || "Kit")} ·{" "}
                      {selectedTransferKit.name || selectedTransferKit.modelName || "Sem nome"}
                    </div>
                    <div className="text-xs text-white/60">
                      {selectedTransferKit.modelName || "Modelo não informado"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-white/70">
                    <span className="rounded-full border border-white/10 px-2 py-1">
                      Disponíveis: {selectedTransferKit.availableCount ?? transferSelectedKitDeviceIds.length}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-1">
                      Vinculados: {selectedTransferKit.linkedCount ?? 0}
                    </span>
                    <span className="rounded-full border border-white/10 px-2 py-1">
                      Transferidos: {selectedTransferKit.transferredCount ?? 0}
                    </span>
                  </div>
                  {transferSelectedKitBlockedCount > 0 ? (
                    <div className="text-xs text-amber-200/90">
                      {transferSelectedKitBlockedCount} item(ns) do kit não serão transferidos por estarem vinculados ou indisponíveis.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">
            <div className="flex items-center gap-2 text-white/60">
              <MapPin className="h-4 w-4" />
              {transferAttachedCount} equipamentos anexados
              {transferSelectionMode === TRANSFER_SELECTION_MODES.KIT && selectedTransferKit ? (
                <span className="rounded-full border border-sky-400/40 bg-sky-500/20 px-2 py-0.5 text-[11px] text-sky-100">
                  via kit {selectedTransferKit.code || selectedTransferKit.name || selectedTransferKit.id}
                </span>
              ) : null}
            </div>
            {selectedDevicesList.length ? (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {selectedDevicesList.map((device) => (
                  transferSelectionMode === TRANSFER_SELECTION_MODES.EQUIPMENTS ? (
                    <button
                      key={`attached-${device.id}`}
                      type="button"
                      onClick={() => removeTransferDevice(device.id)}
                      className="rounded-full border border-sky-400/40 bg-sky-500/20 px-3 py-1 text-sky-100 transition hover:border-red-300/60 hover:bg-red-500/20 hover:text-red-100"
                      title="Remover da transferência"
                    >
                      {(modelById.get(device.modelId)?.name || "Modelo")} · {resolveEquipmentDisplayCode(device) || "Código não cadastrado"} ×
                    </button>
                  ) : (
                    <span
                      key={`attached-${device.id}`}
                      className="rounded-full border border-sky-400/40 bg-sky-500/20 px-3 py-1 text-sky-100"
                    >
                      {(modelById.get(device.modelId)?.name || "Modelo")} · {resolveEquipmentDisplayCode(device) || "Código não cadastrado"}
                    </span>
                  )
                ))}
              </div>
            ) : (
              <div className="mt-3 text-xs text-white/50">Nenhum equipamento anexado ainda.</div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-[2fr_120px]">
            <label className="text-xs uppercase tracking-wide text-white/60">
              Cidade
              <input
                value={transferForm.city}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, city: event.target.value }))}
                placeholder="Cidade"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs uppercase tracking-wide text-white/60">
              UF
              <input
                value={transferForm.state}
                onChange={(event) => setTransferForm((prev) => ({ ...prev, state: event.target.value }))}
                placeholder="UF"
                maxLength={3}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
              />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-white/60">Endereço da transferência (opcional)</span>
            <AddressAutocomplete
              label={null}
              value={transferAddressValue}
              onChange={handleSelectTransferAddress}
              onSelect={handleSelectTransferAddress}
              placeholder="Buscar endereço"
              variant="toolbar"
              containerClassName="w-full"
              portalSuggestions
            />
            <input
              value={transferForm.referencePoint}
              onChange={(event) => setTransferForm((prev) => ({ ...prev, referencePoint: event.target.value }))}
              placeholder="Referência"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
            />
          </div>
          <textarea
            value={transferForm.notes}
            onChange={(event) => setTransferForm((prev) => ({ ...prev, notes: event.target.value }))}
            placeholder="Observações"
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setTransferDrawerOpen(false)}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              disabled={transferSubmitting}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              {transferSubmitting ? "Transferindo..." : "Transferir"}
            </button>
          </div>
        </div>
      </Drawer>
      {transferSubmitting ? (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-sky-500/30 bg-[#0f141c] p-5 text-white shadow-2xl">
            <div className="text-xs uppercase tracking-[0.14em] text-sky-300/90">Transferência</div>
            <div className="mt-2 text-base font-semibold">Processando movimentação de equipamentos</div>
            <div className="mt-1 text-sm text-white/70">Aguarde a conclusão para atualizar a listagem.</div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/2 animate-pulse rounded-full bg-sky-400" />
            </div>
          </div>
        </div>
      ) : null}
      <PageToast toast={toast} />
    </div>
  );
}
