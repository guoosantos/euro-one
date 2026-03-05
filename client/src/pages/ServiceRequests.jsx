import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";
import PageHeader from "../components/ui/PageHeader.jsx";
import FilterBar from "../components/ui/FilterBar.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import SkeletonTable from "../components/ui/SkeletonTable.jsx";
import AddressAutocomplete from "../components/AddressAutocomplete.jsx";
import AutocompleteSelect from "../components/ui/AutocompleteSelect.jsx";
import useVehicles, { formatVehicleLabel } from "../lib/hooks/useVehicles.js";

const STATUS_OPTIONS = [
  { value: "pendente", label: "Pendente" },
  { value: "aprovado_aguardando_equipamento", label: "Aprovado - aguardando equipamento" },
  { value: "aprovado_servico", label: "Aprovado o serviço" },
  { value: "reagendado", label: "Reagendado" },
  { value: "reprovado", label: "Reprovado" },
  { value: "cancelado", label: "Cancelado" },
];

const STATUS_TABS = [
  { key: "pending", label: "Solicitações Pendentes", statuses: ["pendente"] },
  {
    key: "approved",
    label: "Solicitações Aprovadas",
    statuses: [
      "aprovado_aguardando_equipamento",
      "aprovado_servico",
      "aprovado",
      "reagendado",
      "remanejado",
      "remarcado",
    ],
  },
  { key: "canceled", label: "Solicitações Canceladas", statuses: ["reprovado", "cancelado"] },
];

const SERVICE_TYPE_OPTIONS = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Remanejamento",
  "Socorro",
  "Reinstalação",
];

const DEFAULT_FORM = {
  clientId: "",
  clientName: "",
  clientDocument: "",
  clientDocumentType: "",
  clientLegalType: "",
  contactName: "",
  contactChannel: "",
  vehicleId: "",
  vehicleBrand: "",
  vehicleYear: "",
  vehicleColor: "",
  address: "",
  referencePoint: "",
  geoFenceId: "",
  latitude: "",
  longitude: "",
  type: "Instalação",
  serviceReason: "",
  startTimeExpected: "",
  endTimeExpected: "",
  status: "pendente",
  operation: "",
  serviceItem: "",
  assignedTechnicianId: "",
  technicianName: "",
  assignedTeam: "",
  schedulingId: "",
  workOrderId: "",
  selectedEquipments: [],
  isRescheduled: false,
};

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeServiceType(value) {
  if (!value) return "";
  const normalized = String(value).trim().toLowerCase();
  const match = SERVICE_TYPE_OPTIONS.find(
    (option) => option.toLowerCase() === normalized,
  );
  if (match) return match;
  const aliasMap = {
    instalacao: "Instalação",
    manutencao: "Manutenção",
    manutencao_preventiva: "Manutenção",
    retirada: "Retirada",
    remanejamento: "Remanejamento",
    socorro: "Socorro",
    reinstalacao: "Reinstalação",
  };
  return aliasMap[normalized] || value;
}

function resolveClientDocument(client) {
  return (
    client?.attributes?.clientProfile?.documentNumber ||
    client?.attributes?.documentNumber ||
    client?.documentNumber ||
    client?.document ||
    ""
  );
}

function resolveClientDocumentType(client, documentNumber) {
  const rawType =
    client?.attributes?.clientProfile?.documentType ||
    client?.attributes?.documentType ||
    client?.documentType ||
    "";
  if (rawType) return String(rawType).toUpperCase();
  const digits = String(documentNumber || "").replace(/\D/g, "");
  if (digits.length === 14) return "CNPJ";
  if (digits.length === 11) return "CPF";
  return "";
}

function resolveClientLegalType(documentType) {
  if (!documentType) return "";
  return documentType.toUpperCase() === "CNPJ" ? "Pessoa Jurídica" : "Pessoa Física";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toLocalDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function resolveStatusMeta(status, isRescheduled) {
  const normalized = String(status || "").toLowerCase();
  const map = {
    pendente: "Pendente",
    aprovado: "Aprovada",
    aprovado_aguardando_equipamento: "Aprovado - Aguardando Equipamento ao Técnico",
    aprovado_servico: "Aprovado o Serviço",
    reagendado: "Reagendada",
    remarcado: "Reagendada",
    remanejado: "Reagendada",
    reprovado: "Reprovada",
    cancelado: "Cancelada",
  };
  const base = "inline-flex rounded-lg px-2 py-1 text-xs font-semibold";
  let badgeClass = `${base} bg-white/10 text-white/80`;
  if (["aprovado", "aprovado_servico"].includes(normalized)) {
    badgeClass = `${base} bg-emerald-400/20 text-emerald-200`;
  } else if (normalized === "aprovado_aguardando_equipamento") {
    badgeClass = `${base} bg-amber-400/20 text-amber-200`;
  } else if (["reagendado", "remarcado", "remanejado"].includes(normalized)) {
    badgeClass = `${base} bg-amber-400/20 text-amber-200`;
  } else if (["cancelado", "reprovado"].includes(normalized)) {
    badgeClass = `${base} bg-red-400/20 text-red-200`;
  }
  let label = map[normalized] || status || "—";
  if (isRescheduled && !String(label).toLowerCase().includes("reagendad")) {
    label = `${label} (Reagendado)`;
  }
  return { label, badgeClass };
}

function resolveStatusLabel(status, isRescheduled) {
  return resolveStatusMeta(status, isRescheduled).label;
}

function resolveStatusBadge(status, isRescheduled) {
  return resolveStatusMeta(status, isRescheduled).badgeClass;
}

function parseOperationLinks(value) {
  const raw = String(value || "").trim();
  if (!raw) return { appointmentId: "", serviceOrderId: "" };
  const tokens = raw
    .split(/[|;,]/)
    .map((entry) => String(entry).trim())
    .filter(Boolean);
  const links = { appointmentId: "", serviceOrderId: "" };
  tokens.forEach((token) => {
    if (token.startsWith("appointment:")) {
      links.appointmentId = token.replace("appointment:", "").trim();
    }
    if (token.startsWith("os:")) {
      links.serviceOrderId = token.replace("os:", "").trim();
    }
  });
  return links;
}

function buildOperationLinks({ appointmentId, serviceOrderId, previousOperation }) {
  const previous = parseOperationLinks(previousOperation);
  const tokens = [];
  const nextAppointment = appointmentId || previous.appointmentId;
  const nextServiceOrder = serviceOrderId || previous.serviceOrderId;
  if (nextAppointment) tokens.push(`appointment:${nextAppointment}`);
  if (nextServiceOrder) tokens.push(`os:${nextServiceOrder}`);
  return tokens.join(";");
}

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-4xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Solicitação de atendimento</p>
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

const FIELD_INPUT_CLASS =
  "w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white/30 focus:outline-none";
const FIELD_LABEL_CLASS =
  "absolute left-3 -top-2 bg-[#0f141c] px-2 text-[10px] uppercase tracking-[0.12em] text-white/50";

function FloatingField({ label, children, className = "" }) {
  return (
    <div className={`relative pt-2 ${className}`.trim()}>
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      {children}
    </div>
  );
}

function FloatingInput({ label, className = "", ...props }) {
  return (
    <FloatingField label={label}>
      <input className={`${FIELD_INPUT_CLASS} ${className}`.trim()} {...props} />
    </FloatingField>
  );
}

function FloatingSelect({ label, className = "", children, ...props }) {
  return (
    <FloatingField label={label}>
      <select className={`${FIELD_INPUT_CLASS} ${className}`.trim()} {...props}>
        {children}
      </select>
    </FloatingField>
  );
}

export default function ServiceRequests() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tenantId, tenantScope, user, tenants } = useTenant();
  const resolvedClientId = tenantScope === "ALL" ? "" : tenantId || user?.clientId || "";
  const isInternalUser = ["admin", "manager"].includes(user?.role);
  const isTechnician = user?.role === "technician";
  const isClientView = !isInternalUser;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [technicians, setTechnicians] = useState([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [filters, setFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    region: "",
    clientId: "",
  });
  const [draftFilters, setDraftFilters] = useState({
    query: "",
    status: "",
    from: "",
    to: "",
    region: "",
    clientId: "",
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [statusTab, setStatusTab] = useState(STATUS_TABS[0].key);
  const [form, setForm] = useState({ ...DEFAULT_FORM, clientId: resolvedClientId });
  const [autoOpenHandled, setAutoOpenHandled] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const [actionTechnician, setActionTechnician] = useState("");
  const [actionDate, setActionDate] = useState("");
  const [actionReason, setActionReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [activeTab, setActiveTab] = useState("details");
  const [equipmentOrigin, setEquipmentOrigin] = useState("euro");
  const [equipmentOptions, setEquipmentOptions] = useState([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);
  const [transferEquipmentId, setTransferEquipmentId] = useState("");
  const [transferEquipmentName, setTransferEquipmentName] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("1");
  const [transferLog, setTransferLog] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [addressValue, setAddressValue] = useState({ formattedAddress: "" });
  const [filterAddressValue, setFilterAddressValue] = useState({ formattedAddress: "" });
  const { vehicles, loading: vehiclesLoading } = useVehicles({
    includeUnlinked: true,
    includeTelemetry: false,
  });

  const clientOptions = useMemo(
    () =>
      (Array.isArray(tenants) ? tenants : []).map((tenant) => {
        const documentNumber = resolveClientDocument(tenant);
        const documentType = resolveClientDocumentType(tenant, documentNumber);
        const attributes = tenant?.attributes || {};
        const address = attributes.address || attributes.endereco || {};
        const city =
          tenant?.city ||
          attributes.city ||
          attributes.cidade ||
          address.city ||
          address.cidade ||
          address.town ||
          address.municipio ||
          "";
        const state =
          tenant?.state ||
          attributes.state ||
          attributes.uf ||
          attributes.estado ||
          address.state ||
          address.uf ||
          address.estado ||
          "";
        return {
          id: tenant.id,
          name: tenant.name || tenant.company || tenant.id,
          documentNumber,
          documentType,
          legalType: resolveClientLegalType(documentType),
          city,
          state,
        };
      }),
    [tenants],
  );

  const clientAutocompleteOptions = useMemo(
    () =>
      clientOptions.map((client) => ({
        value: String(client.id),
        label: client.name,
        description: client.documentNumber || "",
        documentNumber: client.documentNumber,
        documentType: client.documentType,
        legalType: client.legalType,
      })),
    [clientOptions],
  );

  const vehicleOptions = useMemo(() => {
    if (!Array.isArray(vehicles)) return [];
    return vehicles.map((vehicle) => {
      const label = formatVehicleLabel(vehicle);
      const plate = vehicle?.plate || vehicle?.attributes?.plate || "";
      const name = vehicle?.name || "";
      const device = vehicle?.primaryDevice || vehicle?.device || vehicle?.devices?.[0] || null;
      const deviceId = device?.uniqueId || device?.imei || device?.serial || device?.id || "";
      const searchText = [label, plate, name, vehicle?.id, deviceId].filter(Boolean).join(" ");
      return {
        value: String(vehicle.id),
        label,
        description: plate && name ? `${plate} · ${name}` : plate || name || deviceId,
        searchText,
        vehicle,
      };
    });
  }, [vehicles]);

  const loadVehicleOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = vehicleOptions.filter((vehicle) => {
        const haystack = [vehicle.label, vehicle.description, vehicle.searchText, vehicle.value]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      });
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [vehicleOptions],
  );

  const loadClientOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = clientAutocompleteOptions.filter((client) =>
        client.label.toLowerCase().includes(term),
      );
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [clientAutocompleteOptions],
  );

  const technicianOptions = useMemo(
    () =>
      (Array.isArray(technicians) ? technicians : []).map((technician) => ({
        id: technician.id,
        name: technician.name || technician.fullName || technician.email || String(technician.id),
        team: technician.team || technician.group || technician.assignedTeam || "",
      })),
    [technicians],
  );

  const technicianAutocompleteOptions = useMemo(
    () =>
      technicianOptions.map((technician) => {
        const label = technician.name || String(technician.id);
        return {
          value: String(technician.id),
          label,
          description: technician.team,
          id: technician.id,
          name: technician.name,
        };
      }),
    [technicianOptions],
  );

  const loadTechnicianOptions = useCallback(
    async ({ query, page, pageSize }) => {
      const term = String(query || "").trim().toLowerCase();
      const filtered = technicianAutocompleteOptions.filter((technician) => {
        const haystack = [technician.label, technician.description].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(term);
      });
      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);
      return { options: paged, hasMore: start + pageSize < filtered.length };
    },
    [technicianAutocompleteOptions],
  );

  const loadRequests = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const params = {
        from: nextFilters.from || undefined,
        to: nextFilters.to || undefined,
        category: "request",
      };
      const response = await CoreApi.listTasks(params);
      setItems(Array.isArray(response?.tasks) ? response.tasks : response || []);
    } catch (error) {
      console.error("Falha ao carregar solicitações", error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const loadTechnicians = useCallback(async () => {
    if (!isInternalUser) return;
    setTechniciansLoading(true);
    try {
      const response = await CoreApi.searchTechnicians({ pageSize: 200 });
      const list = response?.items || response?.technicians || response?.data || [];
      setTechnicians(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("Falha ao carregar técnicos", error);
      setTechnicians([]);
    } finally {
      setTechniciansLoading(false);
    }
  }, [isInternalUser]);

  const activeTechnicianId = useMemo(
    () => form.assignedTechnicianId || actionTechnician || "",
    [form.assignedTechnicianId, actionTechnician],
  );

  const loadEquipmentOptions = useCallback(async () => {
    if (!drawerOpen) return;
    const clientId = equipmentOrigin === "cliente" ? form.clientId || resolvedClientId : "";
    setEquipmentLoading(true);
    try {
      const params = clientId ? { clientId } : undefined;
      const list = await CoreApi.listStockItems(params);
      setEquipmentOptions(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("Falha ao carregar equipamentos", error);
      setEquipmentOptions([]);
    } finally {
      setEquipmentLoading(false);
    }
  }, [drawerOpen, equipmentOrigin, form.clientId, resolvedClientId]);

  const loadTransferLog = useCallback(async () => {
    if (!drawerOpen || !editingId) return;
    const clientId = form.clientId || resolvedClientId;
    try {
      const list = await CoreApi.listEquipmentTransfers({ clientId, requestId: editingId });
      setTransferLog(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("Falha ao carregar transferências", error);
      setTransferLog([]);
    }
  }, [drawerOpen, editingId, form.clientId, resolvedClientId]);

  const loadInventory = useCallback(async () => {
    if (!drawerOpen || !activeTechnicianId) return;
    const clientId = form.clientId || resolvedClientId;
    setInventoryLoading(true);
    try {
      const list = await CoreApi.listTechnicianInventory({ clientId, technicianId: activeTechnicianId });
      setInventory(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error("Falha ao carregar estoque do técnico", error);
      setInventory([]);
    } finally {
      setInventoryLoading(false);
    }
  }, [activeTechnicianId, drawerOpen, form.clientId, resolvedClientId]);

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!drawerOpen || !isInternalUser) return;
    loadTechnicians();
  }, [drawerOpen, isInternalUser, loadTechnicians]);

  useEffect(() => {
    if (!drawerOpen || !editingId) return;
    loadEquipmentOptions();
    loadTransferLog();
  }, [drawerOpen, editingId, loadEquipmentOptions, loadTransferLog]);

  useEffect(() => {
    if (!drawerOpen) return;
    loadInventory();
  }, [drawerOpen, activeTechnicianId, loadInventory]);

  useEffect(() => {
    setForm((prev) => (prev.clientId ? prev : { ...prev, clientId: resolvedClientId || prev.clientId }));
  }, [resolvedClientId]);

  const applyFilters = () => {
    const nextFilters = {
      ...filters,
      query: draftFilters.query,
      status: draftFilters.status,
      from: draftFilters.from,
      to: draftFilters.to,
      region: draftFilters.region,
      clientId: draftFilters.clientId,
    };
    setFilters(nextFilters);
    loadRequests(nextFilters);
  };

  const clearFilters = () => {
    const nextFilters = {
      query: "",
      status: "",
      from: "",
      to: "",
      region: "",
      clientId: "",
    };
    setDraftFilters(nextFilters);
    setFilterAddressValue({ formattedAddress: "" });
    setFilters(nextFilters);
    loadRequests(nextFilters);
  };

  const filtered = useMemo(() => {
    const term = filters.query.trim().toLowerCase();
    const statusConfig = STATUS_TABS.find((tab) => tab.key === statusTab);
    const allowedStatuses = statusConfig?.statuses || [];
    return items.filter((item) => {
      const searchable = [
        item.id,
        item.address,
        item.type,
        item.status,
        item.clientName,
        item.clientDocument,
        item.contactName,
        item.contactChannel,
        item.serviceReason,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      if (term && !searchable.some((value) => value.includes(term))) return false;
      if (filters.clientId && String(item.clientId || "") !== String(filters.clientId)) {
        return false;
      }
      if (filters.region && !String(item.address || "").toLowerCase().includes(filters.region.toLowerCase())) {
        return false;
      }
      if (allowedStatuses.length > 0 && !allowedStatuses.includes(String(item.status || ""))) {
        return false;
      }
      return true;
    });
  }, [filters.clientId, filters.query, filters.region, items, statusTab]);

  const extractAppointmentId = useCallback((task) => {
    if (!task) return "";
    if (task.schedulingId) return String(task.schedulingId);
    if (task.serviceItem) return String(task.serviceItem);
    if (task.operation) {
      return parseOperationLinks(task.operation).appointmentId || "";
    }
    return "";
  }, []);

  const openDrawer = (task = null) => {
    setActionMode(null);
    setActionTechnician("");
    setActionDate("");
    setActionReason("");
    setActionError("");
    setActiveTab("details");
    setEquipmentOrigin("euro");
    setTransferEquipmentId("");
    setTransferEquipmentName("");
    setTransferQuantity("1");
    setTransferLog([]);
    setInventory([]);
    setSelectionError("");
    if (task) {
      const startValue = task.startTimeExpected ? new Date(task.startTimeExpected) : null;
      const endValue = task.endTimeExpected ? new Date(task.endTimeExpected) : null;
      const startInput = startValue
        ? isClientView
          ? toLocalDateInput(startValue)
          : toLocalDateTimeInput(startValue)
        : "";
      const endInput = endValue
        ? isClientView
          ? toLocalDateInput(endValue)
          : toLocalDateTimeInput(endValue)
        : "";
      setEditingId(task.id);
      setForm({
        ...DEFAULT_FORM,
        clientId: task.clientId || resolvedClientId || "",
        clientName: task.clientName || "",
        clientDocument: task.clientDocument || "",
        clientDocumentType: resolveClientDocumentType(null, task.clientDocument || ""),
        clientLegalType: resolveClientLegalType(resolveClientDocumentType(null, task.clientDocument || "")),
        contactName: task.contactName || "",
        contactChannel: task.contactChannel || "",
        vehicleId: task.vehicleId || "",
        vehicleBrand: task.vehicleBrand || "",
        vehicleYear: task.vehicleYear || "",
        vehicleColor: task.vehicleColor || "",
        address: task.address || "",
        referencePoint: task.referencePoint || "",
        geoFenceId: task.geoFenceId || "",
        latitude: task.latitude ?? "",
        longitude: task.longitude ?? "",
        type: normalizeServiceType(task.type) || "Instalação",
        serviceReason: task.serviceReason || "",
        startTimeExpected: startInput,
        endTimeExpected: endInput,
        status: task.status || "pendente",
        operation: task.operation || "",
        serviceItem: task.serviceItem || "",
        assignedTechnicianId: task.assignedTechnicianId || "",
        technicianName: task.technicianName || "",
        assignedTeam: task.assignedTeam || "",
        schedulingId: task.schedulingId || "",
        workOrderId: task.workOrderId || "",
        selectedEquipments: Array.isArray(task.selectedEquipments) ? task.selectedEquipments : [],
        isRescheduled: Boolean(task.isRescheduled),
      });
      setAddressValue({
        formattedAddress: task.address || "",
        lat: task.latitude ?? undefined,
        lng: task.longitude ?? undefined,
        placeId: task.geoFenceId ?? undefined,
      });
      const matchVehicle = vehicles.find((vehicle) => String(vehicle.id) === String(task.vehicleId));
      setSelectedVehicle(matchVehicle || null);
      setActionTechnician(task.assignedTechnicianId ? String(task.assignedTechnicianId) : "");
    } else {
      setEditingId(null);
      setForm({ ...DEFAULT_FORM, clientId: resolvedClientId || "" });
      setAddressValue({ formattedAddress: "" });
      setSelectedVehicle(null);
    }
    setDrawerOpen(true);
  };

  useEffect(() => {
    if (autoOpenHandled) return;
    const openId = searchParams.get("open");
    if (!openId) {
      setAutoOpenHandled(true);
      return;
    }
    const match = items.find((item) => String(item.id) === String(openId));
    if (match) {
      openDrawer(match);
      setAutoOpenHandled(true);
    }
  }, [autoOpenHandled, items, searchParams]);

  const handleAddressChange = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setAddressValue(nextValue);
    setForm((prev) => ({
      ...prev,
      address: nextValue.formattedAddress || "",
      latitude: nextValue.lat ?? "",
      longitude: nextValue.lng ?? "",
      geoFenceId: nextValue.placeId || "",
    }));
  };

  const handleFilterAddressChange = (value) => {
    const nextValue = value || { formattedAddress: "" };
    setFilterAddressValue(nextValue);
    setDraftFilters((prev) => ({ ...prev, region: nextValue.formattedAddress || "" }));
  };

  const toIso = useCallback((value, { dateOnly = false } = {}) => {
    if (!value) return null;
    if (dateOnly || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
      const [year, month, day] = String(value).split("-").map((part) => Number(part));
      if (!year || !month || !day) return null;
      const localDate = new Date(year, month - 1, day, 0, 0, 0);
      if (Number.isNaN(localDate.getTime())) return null;
      return localDate.toISOString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }, []);

  const saveRequest = async (payloadForm) => {
    if (!payloadForm.clientId) {
      alert("Selecione o cliente.");
      return;
    }
    if (!payloadForm.vehicleId) {
      alert("Selecione o veículo.");
      return;
    }
    if (!payloadForm.type) {
      alert("Selecione o tipo de serviço.");
      return;
    }
    if (!payloadForm.contactName) {
      alert("Informe o contato responsável.");
      return;
    }
    if (!payloadForm.contactChannel) {
      alert("Informe o telefone/whatsapp do contato.");
      return;
    }
    if (!payloadForm.address) {
      alert("Informe o endereço.");
      return;
    }
    if (!payloadForm.serviceReason) {
      alert("Informe o motivo/descrição.");
      return;
    }
    if (!payloadForm.startTimeExpected) {
      alert("Informe a data do serviço.");
      return;
    }

    if (!isClientView && !payloadForm.endTimeExpected) {
      alert("Informe a data do serviço.");
      return;
    }
    setSaving(true);
    try {
      const resolvedStart = toIso(payloadForm.startTimeExpected, { dateOnly: isClientView });
      const resolvedEnd = toIso(payloadForm.endTimeExpected) || (isClientView ? resolvedStart : null);
      const payload = {
        clientId: payloadForm.clientId || resolvedClientId,
        clientName: payloadForm.clientName,
        clientDocument: payloadForm.clientDocument,
        contactName: payloadForm.contactName,
        contactChannel: payloadForm.contactChannel,
        vehicleId: payloadForm.vehicleId || null,
        vehicleBrand: payloadForm.vehicleBrand || null,
        vehicleYear: payloadForm.vehicleYear || null,
        vehicleColor: payloadForm.vehicleColor || null,
        address: payloadForm.address,
        referencePoint: payloadForm.referencePoint,
        geoFenceId: payloadForm.geoFenceId || null,
        serviceReason: payloadForm.serviceReason,
        status: isClientView ? "pendente" : payloadForm.status,
        latitude: payloadForm.latitude !== "" ? Number(payloadForm.latitude) : null,
        longitude: payloadForm.longitude !== "" ? Number(payloadForm.longitude) : null,
        startTimeExpected: resolvedStart,
        endTimeExpected: resolvedEnd,
        type: normalizeServiceType(payloadForm.type),
        category: "request",
        assignedTechnicianId: payloadForm.assignedTechnicianId || null,
        technicianName: payloadForm.technicianName || null,
        assignedTeam: payloadForm.assignedTeam || null,
        schedulingId: payloadForm.schedulingId || null,
        workOrderId: payloadForm.workOrderId || null,
        selectedEquipments: Array.isArray(payloadForm.selectedEquipments) ? payloadForm.selectedEquipments : [],
        isRescheduled: Boolean(payloadForm.isRescheduled),
      };
      if (editingId) {
        await CoreApi.updateTask(editingId, payload);
      } else {
        await CoreApi.createTask(payload);
      }
      setDrawerOpen(false);
      await loadRequests();
    } catch (error) {
      console.error("Falha ao salvar solicitação", error);
      alert("Não foi possível salvar a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    await saveRequest(form);
  };

  const buildEquipmentsPayload = useCallback(() => {
    if (!Array.isArray(form.selectedEquipments)) return null;
    const normalized = form.selectedEquipments
      .map((item) => ({
        equipmentId: item?.equipmentId || item?.id || null,
        model: item?.equipmentName || item?.name || item?.label || null,
        installLocation: item?.installLocation || item?.location || null,
      }))
      .filter((item) => item.equipmentId || item.model || item.installLocation);
    return normalized.length ? normalized : null;
  }, [form.selectedEquipments]);

  const handleApproveRequest = async () => {
    if (!editingId) return;
    if (!form.clientId) {
      alert("Selecione o cliente antes de aprovar.");
      return;
    }
    if (!form.vehicleId) {
      alert("Selecione o veículo antes de aprovar.");
      return;
    }
    if (!actionTechnician) {
      setActionError("Selecione um técnico antes de aprovar.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const technician = technicianOptions.find((tech) => String(tech.id) === String(actionTechnician));
      const technicianName = technician?.name || "";
      if (!technicianName) {
        setActionError("Selecione um técnico válido.");
        return;
      }

      const approvedPayload = {
        status: "aprovado_aguardando_equipamento",
        category: "request",
        clientId: form.clientId || resolvedClientId,
        assignedTechnicianId: String(actionTechnician),
        technicianName,
        assignedTeam: technician?.team || "",
      };

      await CoreApi.updateTask(editingId, approvedPayload);
      setForm((prev) => ({
        ...prev,
        status: approvedPayload.status,
        assignedTechnicianId: approvedPayload.assignedTechnicianId,
        technicianName: approvedPayload.technicianName,
        assignedTeam: approvedPayload.assignedTeam,
      }));
      setActionMode(null);
      setActiveTab("transfer");
      await loadRequests();
      loadInventory();
    } catch (error) {
      console.error("Falha ao aprovar solicitação", error);
      const status = error?.response?.status || error?.status;
      if (status === 403) {
        alert("Você não tem permissão para aprovar esta solicitação para o cliente selecionado.");
        return;
      }
      alert("Não foi possível aprovar a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmService = async () => {
    if (!editingId) return;
    if (!form.clientId) {
      alert("Selecione o cliente antes de continuar.");
      return;
    }
    if (!form.vehicleId) {
      alert("Selecione o veículo antes de continuar.");
      return;
    }
    const technicianId = form.assignedTechnicianId || actionTechnician;
    if (!technicianId) {
      setActionError("Selecione um técnico antes de concluir.");
      return;
    }
    const technician = technicianOptions.find((tech) => String(tech.id) === String(technicianId));
    const technicianName = form.technicianName || technician?.name || "";
    if (!technicianName) {
      setActionError("Selecione um técnico válido.");
      return;
    }
    const resolvedServiceDate = toIso(form.endTimeExpected || form.startTimeExpected);
    if (!resolvedServiceDate) {
      setActionError("Informe a data do serviço.");
      return;
    }

    setSaving(true);
    setActionError("");
    try {
      const operationLinks = parseOperationLinks(form.operation);
      let appointmentId = form.schedulingId || form.serviceItem || operationLinks.appointmentId || "";
      let serviceOrderId = form.workOrderId || operationLinks.serviceOrderId || "";

      if (appointmentId) {
        await CoreApi.updateTask(appointmentId, {
          clientId: form.clientId || resolvedClientId,
          clientName: form.clientName,
          clientDocument: form.clientDocument,
          contactName: form.contactName,
          contactChannel: form.contactChannel,
          vehicleId: form.vehicleId || null,
          vehicleBrand: form.vehicleBrand || null,
          vehicleYear: form.vehicleYear || null,
          vehicleColor: form.vehicleColor || null,
          address: form.address,
          referencePoint: form.referencePoint,
          geoFenceId: form.geoFenceId || null,
          serviceReason: form.serviceReason,
          latitude: form.latitude !== "" ? Number(form.latitude) : null,
          longitude: form.longitude !== "" ? Number(form.longitude) : null,
          startTimeExpected: resolvedServiceDate,
          endTimeExpected: resolvedServiceDate,
          type: normalizeServiceType(form.type),
          category: "appointment",
          operation: `request:${editingId}`,
          serviceItem: String(editingId),
          selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
          technicianName,
          assignedTeam: technician?.team || form.assignedTeam || "",
          status: "confirmado",
        });
      } else {
        const appointmentPayload = {
          clientId: form.clientId || resolvedClientId,
          clientName: form.clientName,
          clientDocument: form.clientDocument,
          contactName: form.contactName,
          contactChannel: form.contactChannel,
          vehicleId: form.vehicleId || null,
          vehicleBrand: form.vehicleBrand || null,
          vehicleYear: form.vehicleYear || null,
          vehicleColor: form.vehicleColor || null,
          address: form.address,
          referencePoint: form.referencePoint,
          geoFenceId: form.geoFenceId || null,
          serviceReason: form.serviceReason,
          status: "confirmado",
          latitude: form.latitude !== "" ? Number(form.latitude) : null,
          longitude: form.longitude !== "" ? Number(form.longitude) : null,
          startTimeExpected: resolvedServiceDate,
          endTimeExpected: resolvedServiceDate,
          type: normalizeServiceType(form.type),
          category: "appointment",
          operation: `request:${editingId}`,
          serviceItem: String(editingId),
          selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
          technicianName,
          assignedTeam: technician?.team || "",
        };
        const appointmentResponse = await CoreApi.createTask(appointmentPayload);
        const appointment = appointmentResponse?.task || appointmentResponse;
        appointmentId = appointment?.id ? String(appointment.id) : "";
      }

      const equipmentsData = buildEquipmentsPayload();
      if (serviceOrderId) {
        await api.patch(`core/service-orders/${serviceOrderId}`, {
          clientId: form.clientId || resolvedClientId,
          clientName: form.clientName,
          vehicleId: form.vehicleId || null,
          technicianName,
          type: normalizeServiceType(form.type),
          status: "AGENDADA",
          startAt: resolvedServiceDate,
          endAt: resolvedServiceDate,
          address: form.address,
          reason: form.serviceReason,
          notes: form.serviceReason,
          responsibleName: form.contactName,
          responsiblePhone: form.contactChannel,
          equipmentsData,
          externalRef: `request:${editingId}`,
        });
      } else {
        const serviceOrderPayload = {
          clientId: form.clientId || resolvedClientId,
          clientName: form.clientName,
          vehicleId: form.vehicleId || null,
          technicianName,
          type: normalizeServiceType(form.type),
          status: "AGENDADA",
          startAt: resolvedServiceDate,
          endAt: resolvedServiceDate,
          address: form.address,
          reason: form.serviceReason,
          notes: form.serviceReason,
          responsibleName: form.contactName,
          responsiblePhone: form.contactChannel,
          equipmentsData,
          externalRef: `request:${editingId}`,
        };

        const serviceOrderResponse = await api.post("core/service-orders", serviceOrderPayload);
        const serviceOrder = serviceOrderResponse?.data?.item || null;
        serviceOrderId = serviceOrder?.id ? String(serviceOrder.id) : serviceOrderId;
      }

      const updatedOperation = buildOperationLinks({
        appointmentId,
        serviceOrderId,
        previousOperation: form.operation,
      });

      await CoreApi.updateTask(editingId, {
        status: "aprovado_servico",
        category: "request",
        clientId: form.clientId || resolvedClientId,
        operation: updatedOperation,
        serviceItem: appointmentId || form.serviceItem || "",
        schedulingId: appointmentId || form.schedulingId || "",
        workOrderId: serviceOrderId || form.workOrderId || "",
        selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
        assignedTechnicianId: String(technicianId),
        technicianName,
        assignedTeam: technician?.team || form.assignedTeam || "",
      });

      setForm((prev) => ({
        ...prev,
        status: "aprovado_servico",
        operation: updatedOperation,
        serviceItem: appointmentId || prev.serviceItem,
        schedulingId: appointmentId || prev.schedulingId,
        workOrderId: serviceOrderId || prev.workOrderId,
        assignedTechnicianId: String(technicianId),
        technicianName,
        assignedTeam: technician?.team || prev.assignedTeam,
      }));
      setDrawerOpen(false);
      await loadRequests();
    } catch (error) {
      console.error("Falha ao concluir aprovação de serviço", error);
      alert("Não foi possível concluir a aprovação do serviço.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelRequest = async () => {
    if (!editingId) return;
    if (!window.confirm("Confirmar cancelamento desta solicitação?")) return;
    setSaving(true);
    setActionError("");
    try {
      const canceledBy = user?.name || user?.email || user?.id || null;
      const appointmentId = extractAppointmentId(form);
      if (appointmentId) {
        await CoreApi.updateTask(appointmentId, { status: "cancelado" });
      }
      const serviceOrderId = form.workOrderId || parseOperationLinks(form.operation).serviceOrderId;
      if (serviceOrderId) {
        await api.patch(`core/service-orders/${serviceOrderId}`, { status: "CANCELADA" });
      }
      await CoreApi.updateTask(editingId, {
        status: "cancelado",
        cancelReason: actionReason || undefined,
        authorizationStatus: "cancelado",
        authorizationBy: canceledBy,
      });
      setDrawerOpen(false);
      await loadRequests();
    } catch (error) {
      console.error("Falha ao cancelar solicitação", error);
      alert("Não foi possível cancelar a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  const handleRescheduleRequest = async () => {
    if (!editingId) return;
    if (!actionDate) {
      setActionError("Informe a nova data do serviço.");
      return;
    }
    const serviceIso = toIso(actionDate);
    if (!serviceIso) {
      setActionError("Data inválida.");
      return;
    }
    setSaving(true);
    setActionError("");
    try {
      const technicianId = actionTechnician || form.assignedTechnicianId || "";
      const technician = technicianOptions.find((tech) => String(tech.id) === String(technicianId));
      const technicianName = technician?.name || form.technicianName || "";

      let appointmentId = extractAppointmentId(form);
      if (appointmentId) {
        await CoreApi.updateTask(appointmentId, {
          startTimeExpected: serviceIso,
          endTimeExpected: serviceIso,
          status: "remarcado",
          rescheduleReason: actionReason || undefined,
          selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
          technicianName: technicianName || undefined,
          assignedTeam: technician?.team || form.assignedTeam || undefined,
        });
      } else {
        const appointmentPayload = {
          clientId: form.clientId || resolvedClientId,
          clientName: form.clientName,
          clientDocument: form.clientDocument,
          contactName: form.contactName,
          contactChannel: form.contactChannel,
          vehicleId: form.vehicleId || null,
          vehicleBrand: form.vehicleBrand || null,
          vehicleYear: form.vehicleYear || null,
          vehicleColor: form.vehicleColor || null,
          address: form.address,
          referencePoint: form.referencePoint,
          geoFenceId: form.geoFenceId || null,
          serviceReason: form.serviceReason,
          status: "remarcado",
          latitude: form.latitude !== "" ? Number(form.latitude) : null,
          longitude: form.longitude !== "" ? Number(form.longitude) : null,
          startTimeExpected: serviceIso,
          endTimeExpected: serviceIso,
          type: normalizeServiceType(form.type),
          category: "appointment",
          operation: `request:${editingId}`,
          serviceItem: String(editingId),
          selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
          technicianName: technicianName || undefined,
          assignedTeam: technician?.team || form.assignedTeam || undefined,
        };
        const appointmentResponse = await CoreApi.createTask(appointmentPayload);
        const appointment = appointmentResponse?.task || appointmentResponse;
        appointmentId = appointment?.id ? String(appointment.id) : appointmentId;
      }

      const serviceOrderId = form.workOrderId || parseOperationLinks(form.operation).serviceOrderId;
      if (serviceOrderId) {
        await api.patch(`core/service-orders/${serviceOrderId}`, {
          startAt: serviceIso,
          endAt: serviceIso,
          status: "REMANEJADA",
          technicianName: technicianName || undefined,
        });
      }

      const nextStatus =
        form.status === "aprovado_servico" || form.status === "aprovado_aguardando_equipamento"
          ? form.status
          : "reagendado";

      const updatedOperation = buildOperationLinks({
        appointmentId,
        serviceOrderId,
        previousOperation: form.operation,
      });

      await CoreApi.updateTask(editingId, {
        status: nextStatus,
        startTimeExpected: form.startTimeExpected ? toIso(form.startTimeExpected) : serviceIso,
        endTimeExpected: serviceIso,
        rescheduleReason: actionReason || undefined,
        isRescheduled: true,
        assignedTechnicianId: technicianId || undefined,
        technicianName: technicianName || undefined,
        assignedTeam: technician?.team || form.assignedTeam || undefined,
        operation: updatedOperation,
        serviceItem: appointmentId || form.serviceItem || undefined,
        schedulingId: appointmentId || form.schedulingId || undefined,
      });
      setDrawerOpen(false);
      await loadRequests();
    } catch (error) {
      console.error("Falha ao reagendar solicitação", error);
      alert("Não foi possível reagendar a solicitação.");
    } finally {
      setSaving(false);
    }
  };

  const handleTransferEquipment = async () => {
    if (!editingId) return;
    const clientId = form.clientId || resolvedClientId;
    const technicianId = form.assignedTechnicianId;
    if (!clientId || !technicianId) {
      setSelectionError("Selecione um técnico antes de transferir.");
      return;
    }
    if (!transferEquipmentId && !transferEquipmentName) {
      setSelectionError("Selecione ou informe o equipamento.");
      return;
    }
    const technician = technicianOptions.find((tech) => String(tech.id) === String(technicianId));
    setSelectionError("");
    setSaving(true);
    try {
      const selectedItem = equipmentOptions.find((item) => String(item.id) === String(transferEquipmentId));
      await CoreApi.createEquipmentTransfer({
        requestId: editingId,
        clientId,
        origin: equipmentOrigin,
        equipmentId: transferEquipmentId || null,
        equipmentName: transferEquipmentName || selectedItem?.name || selectedItem?.type || null,
        quantity: Number(transferQuantity) || 1,
        technicianId,
        technicianName: technician?.name || form.technicianName || null,
      });
      setTransferEquipmentId("");
      setTransferEquipmentName("");
      setTransferQuantity("1");
      await loadTransferLog();
      await loadInventory();
    } catch (error) {
      console.error("Falha ao transferir equipamento", error);
      setSelectionError("Não foi possível transferir o equipamento.");
    } finally {
      setSaving(false);
    }
  };

  const toggleEquipmentSelection = (item) => {
    if (!item) return;
    const key = `${item.origin || ""}:${item.equipmentId || item.equipmentName || ""}`;
    setForm((prev) => {
      const current = Array.isArray(prev.selectedEquipments) ? prev.selectedEquipments : [];
      const exists = current.find(
        (entry) =>
          `${entry.origin || ""}:${entry.equipmentId || entry.equipmentName || ""}` === key,
      );
      if (exists) {
        return { ...prev, selectedEquipments: current.filter((entry) => entry !== exists) };
      }
      return {
        ...prev,
        selectedEquipments: [
          ...current,
          {
            origin: item.origin || "cliente",
            equipmentId: item.equipmentId || null,
            equipmentName: item.equipmentName || null,
            quantity: item.quantity || 1,
          },
        ],
      };
    });
  };

  const handleSaveEquipmentSelection = async () => {
    if (!editingId) return;
    setSaving(true);
    setSelectionError("");
    try {
      await CoreApi.updateTask(editingId, {
        selectedEquipments: Array.isArray(form.selectedEquipments) ? form.selectedEquipments : [],
      });
      await loadRequests();
    } catch (error) {
      console.error("Falha ao salvar seleção de equipamentos", error);
      setSelectionError("Não foi possível salvar a seleção.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!form.clientId) return;
    const match = clientOptions.find((client) => String(client.id) === String(form.clientId));
    if (!match) return;
    setForm((prev) => ({
      ...prev,
      clientName: match.name || prev.clientName,
      clientDocument: match.documentNumber || prev.clientDocument,
      clientDocumentType: match.documentType || prev.clientDocumentType,
      clientLegalType: match.legalType || prev.clientLegalType,
    }));
  }, [clientOptions, form.clientId]);

  useEffect(() => {
    if (!form.vehicleId) {
      setSelectedVehicle(null);
      return;
    }
    const match = vehicles.find((vehicle) => String(vehicle.id) === String(form.vehicleId));
    setSelectedVehicle(match || null);
  }, [form.vehicleId, vehicles]);

  useEffect(() => {
    if (!selectedVehicle) return;
    setForm((prev) => ({
      ...prev,
      vehicleBrand: prev.vehicleBrand || selectedVehicle.brand || selectedVehicle.attributes?.brand || "",
      vehicleYear:
        prev.vehicleYear ||
        selectedVehicle.modelYear ||
        selectedVehicle.manufactureYear ||
        selectedVehicle.attributes?.modelYear ||
        "",
      vehicleColor: prev.vehicleColor || selectedVehicle.color || selectedVehicle.attributes?.color || "",
    }));
  }, [selectedVehicle]);

  const selectedVehicleDeviceLabel = useMemo(() => {
    if (!selectedVehicle) return "";
    const device =
      selectedVehicle.primaryDevice ||
      selectedVehicle.device ||
      (Array.isArray(selectedVehicle.devices) ? selectedVehicle.devices[0] : null);
    return device?.uniqueId || device?.name || device?.id || "";
  }, [selectedVehicle]);

  const operationLinks = useMemo(() => parseOperationLinks(form.operation), [form.operation]);
  const selectedClientMeta = useMemo(
    () => clientOptions.find((client) => String(client.id) === String(form.clientId)),
    [clientOptions, form.clientId],
  );
  const appointmentLinkId = useMemo(
    () => form.schedulingId || form.serviceItem || operationLinks.appointmentId || "",
    [form.schedulingId, form.serviceItem, operationLinks.appointmentId],
  );
  const serviceOrderLinkId = useMemo(
    () => form.workOrderId || operationLinks.serviceOrderId || "",
    [form.workOrderId, operationLinks.serviceOrderId],
  );

  const openActionMenu = useCallback((mode) => {
    setActionMode(mode);
    setActionError("");
    if (mode === "reschedule") {
      const rawDate = form.endTimeExpected || form.startTimeExpected || "";
      setActionDate(rawDate ? toLocalDateTimeInput(rawDate) : "");
      setActionTechnician(form.assignedTechnicianId || "");
    } else {
      setActionDate("");
    }
    if (mode === "approve") {
      setActionTechnician(form.assignedTechnicianId || actionTechnician || "");
    }
    if (mode === "cancel") {
      setActionTechnician("");
    }
    if (mode !== "cancel" && mode !== "reschedule") {
      setActionReason("");
    }
  }, [actionTechnician, form.assignedTechnicianId, form.endTimeExpected, form.startTimeExpected]);

  const visibleTabs = useMemo(() => {
    const tabs = [{ key: "details", label: "Detalhes" }];
    if (editingId && isInternalUser) {
      tabs.push({ key: "actions", label: "Ações" });
    }
    if (editingId) {
      tabs.push({ key: "transfer", label: "Transferir Equipamento" });
    }
    return tabs;
  }, [editingId, isInternalUser]);

  useEffect(() => {
    if (!visibleTabs.find((tab) => tab.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || "details");
    }
  }, [activeTab, visibleTabs]);

  const inventoryByOrigin = useMemo(() => {
    const buckets = { euro: [], cliente: [] };
    (Array.isArray(inventory) ? inventory : []).forEach((item) => {
      const key = item?.origin === "euro" ? "euro" : "cliente";
      buckets[key].push(item);
    });
    return buckets;
  }, [inventory]);

  const selectedEquipmentKeys = useMemo(() => {
    const keys = new Set();
    (Array.isArray(form.selectedEquipments) ? form.selectedEquipments : []).forEach((item) => {
      keys.add(`${item.origin || ""}:${item.equipmentId || item.equipmentName || ""}`);
    });
    return keys;
  }, [form.selectedEquipments]);

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <button
              className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              onClick={loadRequests}
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Atualizar
              </span>
            </button>
            <button
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
              onClick={() => openDrawer(null)}
            >
              Nova solicitação
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setStatusTab(tab.key)}
            className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
              statusTab === tab.key
                ? "bg-sky-500 text-black"
                : "bg-white/10 text-white/70 hover:bg-white/15"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <FilterBar
        left={
          <div className="flex w-full flex-wrap items-center gap-3">
            <input
              value={draftFilters.query}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, query: event.target.value }))}
              placeholder="Buscar por cliente, documento, motivo"
              className="min-w-[240px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/30 focus:outline-none"
            />
            <AutocompleteSelect
              label="Cliente"
              placeholder="Buscar cliente"
              value={draftFilters.clientId}
              options={clientAutocompleteOptions}
              loadOptions={loadClientOptions}
              onChange={(value) => setDraftFilters((prev) => ({ ...prev, clientId: value }))}
              allowClear
              className="min-w-[220px] flex-1"
            />
            <div className="min-w-[240px] flex-1">
              <span className="block text-xs uppercase tracking-wide text-white/60">Endereço</span>
              <AddressAutocomplete
                label={null}
                value={filterAddressValue}
                onChange={handleFilterAddressChange}
                placeholder="Buscar endereço"
                variant="toolbar"
                containerClassName="w-full"
                portalSuggestions
              />
            </div>
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, from: event.target.value }))}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) => setDraftFilters((prev) => ({ ...prev, to: event.target.value }))}
              className="min-w-[160px] flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            />
          </div>
        }
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-xl bg-sky-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
            >
              Aplicar
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm text-white transition hover:bg-white/15"
            >
              Limpar
            </button>
          </div>
        }
      />

      <DataTable className="w-full" tableClassName="min-w-[1200px] w-full">
        <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
          <tr className="text-left">
            <th className="w-64 px-4 py-3">Cliente</th>
            <th className="w-44 px-4 py-3">Data</th>
            <th className="w-96 px-4 py-3">Endereço</th>
            <th className="w-56 px-4 py-3">Tipo do Serviço</th>
            <th className="w-52 px-4 py-3">Responsável</th>
            <th className="w-36 px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {loading && (
            <tr>
              <td colSpan={6} className="px-4 py-6">
                <SkeletonTable rows={6} columns={6} />
              </td>
            </tr>
          )}
          {!loading && filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8">
                <EmptyState
                  title="Nenhuma solicitação encontrada."
                  subtitle="Crie uma nova solicitação para iniciar o atendimento."
                  action={
                    <button
                      className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
                      onClick={() => openDrawer(null)}
                    >
                      Nova solicitação
                    </button>
                  }
                />
              </td>
            </tr>
          )}
          {!loading &&
            filtered.map((item) => (
              <tr
                key={item.id}
                className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                onClick={() => openDrawer(item)}
              >
                <td className="px-4 py-3">
                  <div className="text-white/90">{item.clientName || "—"}</div>
                  <div className="text-xs text-white/50">{item.clientDocument || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">
                  {formatDate(item.startTimeExpected || item.endTimeExpected)}
                </td>
                <td className="px-4 py-3">
                  <div className="text-white/90">{item.address || "—"}</div>
                  <div className="text-xs text-white/50">{item.referencePoint || "—"}</div>
                </td>
                <td className="px-4 py-3 text-white/90">{normalizeServiceType(item.type) || "—"}</td>
                <td className="px-4 py-3 text-white/90">{item.contactName || item.ownerName || "—"}</td>
                <td className="px-4 py-3">
                  <span className={resolveStatusBadge(item.status, item.isRescheduled)}>
                    {resolveStatusLabel(item.status, item.isRescheduled)}
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </DataTable>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Editar solicitação" : "Criar solicitação"}
        description="Registre a necessidade do cliente para iniciar o fluxo de atendimento."
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    activeTab === tab.key ? "bg-sky-500 text-black" : "bg-white/10 text-white/70 hover:bg-white/15"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {editingId ? (
              <span className={resolveStatusBadge(form.status, form.isRescheduled)}>
                {resolveStatusLabel(form.status, form.isRescheduled)}
              </span>
            ) : null}
          </div>

          {editingId && activeTab === "details" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
              <span className="rounded-lg bg-white/10 px-3 py-1">Solicitação: {editingId}</span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(editingId)}
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
              >
                Copiar
              </button>
            </div>
          ) : null}

          {activeTab === "details" && (
            <>
              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Cliente</h3>
                {isTechnician ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <FloatingInput
                      label="Cliente"
                      value={form.clientName || selectedClientMeta?.name || "—"}
                      readOnly
                    />
                    <FloatingInput
                      label="Cidade/UF"
                      value={[selectedClientMeta?.city, selectedClientMeta?.state].filter(Boolean).join("/") || "—"}
                      readOnly
                    />
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-3">
                    <FloatingField label="Nome do cliente">
                      <AutocompleteSelect
                        label={null}
                        placeholder="Buscar cliente"
                        value={form.clientId}
                        options={clientAutocompleteOptions}
                        loadOptions={loadClientOptions}
                        onChange={(value) => {
                          const match = clientOptions.find((client) => String(client.id) === String(value));
                          setForm((prev) => ({
                            ...prev,
                            clientId: value || "",
                            clientName: value ? match?.name || prev.clientName : "",
                            clientDocument: value ? match?.documentNumber || prev.clientDocument : "",
                            clientDocumentType: value ? match?.documentType || prev.clientDocumentType : "",
                            clientLegalType: value ? match?.legalType || prev.clientLegalType : "",
                          }));
                        }}
                        allowClear={isInternalUser}
                        disabled={!isInternalUser && clientOptions.length <= 1}
                        inputClassName={FIELD_INPUT_CLASS}
                      />
                    </FloatingField>
                    <FloatingInput
                      label="CNPJ"
                      value={form.clientDocument}
                      onChange={(event) => setForm((prev) => ({ ...prev, clientDocument: event.target.value }))}
                      placeholder="00.000.000/0000-00"
                      readOnly={isClientView}
                    />
                    <FloatingInput
                      label="Tipo"
                      value={form.clientLegalType || resolveClientLegalType(form.clientDocumentType) || "—"}
                      readOnly
                    />
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Veículo</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingField label="Buscar veículo">
                    <AutocompleteSelect
                      label={null}
                      placeholder={vehiclesLoading ? "Carregando veículos..." : "Placa, nome, IMEI ou ID"}
                      value={form.vehicleId}
                      options={vehicleOptions}
                      loadOptions={loadVehicleOptions}
                      onChange={(value, option) => {
                        setForm((prev) => ({ ...prev, vehicleId: value || "" }));
                        setSelectedVehicle(option?.vehicle || null);
                      }}
                      allowClear
                      disabled={vehiclesLoading}
                      inputClassName={FIELD_INPUT_CLASS}
                    />
                  </FloatingField>
                  <FloatingInput
                    label="Placa"
                    value={selectedVehicle?.plate || "—"}
                    readOnly
                    className="text-white/70"
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <FloatingInput
                    label="Marca"
                    value={form.vehicleBrand}
                    onChange={(event) => setForm((prev) => ({ ...prev, vehicleBrand: event.target.value }))}
                    placeholder="Ex: Volkswagen"
                  />
                  <FloatingInput
                    label="Ano"
                    value={form.vehicleYear}
                    onChange={(event) => setForm((prev) => ({ ...prev, vehicleYear: event.target.value }))}
                    placeholder="Ex: 2022"
                  />
                  <FloatingInput
                    label="Cor"
                    value={form.vehicleColor}
                    onChange={(event) => setForm((prev) => ({ ...prev, vehicleColor: event.target.value }))}
                    placeholder="Ex: Prata"
                  />
                </div>
                {selectedVehicle ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                    <div>Modelo: {selectedVehicle.name || selectedVehicle.model || "—"}</div>
                    <div>Dispositivo: {selectedVehicleDeviceLabel || "—"}</div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60">
                    Selecione um veículo para exibir detalhes adicionais.
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Contato</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingInput
                    label="Responsável"
                    value={form.contactName}
                    onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
                    placeholder="Responsável local"
                  />
                  <FloatingInput
                    label="Telefone"
                    value={form.contactChannel}
                    onChange={(event) => setForm((prev) => ({ ...prev, contactChannel: event.target.value }))}
                    placeholder="Telefone/WhatsApp"
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Local</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingField label="Endereço">
                    <AddressAutocomplete
                      label={null}
                      value={addressValue}
                      onChange={handleAddressChange}
                      onSelect={handleAddressChange}
                      placeholder="Buscar endereço"
                      variant="toolbar"
                      containerClassName="w-full rounded-xl border-white/10 bg-black/30 px-4 py-3"
                      portalSuggestions
                      inputClassName="text-sm text-white placeholder:text-white/40"
                    />
                  </FloatingField>
                  <FloatingInput
                    label="Perto"
                    value={form.referencePoint}
                    onChange={(event) => setForm((prev) => ({ ...prev, referencePoint: event.target.value }))}
                    placeholder="Ex: perto do posto X"
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Serviço</h3>
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingSelect
                    label="Serviço"
                    value={form.type}
                    onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                  >
                    {SERVICE_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </FloatingSelect>
                  <FloatingInput
                    label="Observação"
                    value={form.serviceReason}
                    onChange={(event) => setForm((prev) => ({ ...prev, serviceReason: event.target.value }))}
                    placeholder="Observações do serviço"
                  />
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Datas</h3>
                {isClientView ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <FloatingInput
                      label="Data do Serviço"
                      type="date"
                      value={form.startTimeExpected}
                      onChange={(event) => setForm((prev) => ({ ...prev, startTimeExpected: event.target.value }))}
                    />
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    <FloatingInput
                      label="Data da Solicitação"
                      type="datetime-local"
                      value={form.startTimeExpected}
                      onChange={(event) => setForm((prev) => ({ ...prev, startTimeExpected: event.target.value }))}
                    />
                    <FloatingInput
                      label="Data do Serviço"
                      type="datetime-local"
                      value={form.endTimeExpected}
                      onChange={(event) => setForm((prev) => ({ ...prev, endTimeExpected: event.target.value }))}
                    />
                  </div>
                )}
              </section>

              {editingId ? (
                <section className="space-y-3">
                  <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Vínculos</h3>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
                    <span className="rounded-lg bg-white/10 px-3 py-1 text-xs">
                      Agendamento: {appointmentLinkId ? "Vinculado" : "Sem agendamento"}
                    </span>
                    {appointmentLinkId ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/appointments?open=${appointmentLinkId}`)}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
                      >
                        Ver agendamento
                      </button>
                    ) : null}
                    <span className="rounded-lg bg-white/10 px-3 py-1 text-xs">
                      OS: {serviceOrderLinkId ? "Gerada" : "Sem OS"}
                    </span>
                    {serviceOrderLinkId ? (
                      <button
                        type="button"
                        onClick={() => navigate(`/services/${serviceOrderLinkId}`)}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white hover:border-white/30"
                      >
                        Ver OS
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </>
          )}

          {activeTab === "actions" && isInternalUser && editingId ? (
            <section className="space-y-6">
              <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Ações</h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openActionMenu("approve")}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    actionMode === "approve" ? "bg-emerald-400 text-black" : "bg-white/10 text-white/80 hover:bg-white/15"
                  }`}
                >
                  Aprovar
                </button>
                <button
                  type="button"
                  onClick={() => openActionMenu("reschedule")}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    actionMode === "reschedule" ? "bg-amber-300 text-black" : "bg-white/10 text-white/80 hover:bg-white/15"
                  }`}
                >
                  Reagendar
                </button>
                <button
                  type="button"
                  onClick={() => openActionMenu("cancel")}
                  className={`rounded-xl px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                    actionMode === "cancel" ? "bg-red-400 text-black" : "bg-white/10 text-white/80 hover:bg-white/15"
                  }`}
                >
                  Cancelar
                </button>
              </div>

              {actionMode === "approve" && (
                <div className="space-y-4">
                  <FloatingField label="Técnico">
                    <AutocompleteSelect
                      label={null}
                      placeholder={techniciansLoading ? "Carregando técnicos..." : "Selecione o técnico"}
                      value={actionTechnician}
                      options={technicianAutocompleteOptions}
                      loadOptions={loadTechnicianOptions}
                      onChange={(value) => setActionTechnician(value || "")}
                      allowClear
                      disabled={techniciansLoading}
                      inputClassName={FIELD_INPUT_CLASS}
                    />
                  </FloatingField>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
                      <div className="font-semibold text-white">Equipamentos disponíveis com o técnico</div>
                      {inventoryLoading ? (
                        <div className="mt-2 text-white/50">Carregando estoque...</div>
                      ) : (
                        <>
                          <div className="mt-3 text-[10px] uppercase tracking-[0.12em] text-white/50">Base Euro</div>
                          {inventoryByOrigin.euro.length ? (
                            <ul className="mt-2 space-y-1">
                              {inventoryByOrigin.euro.map((item) => (
                                <li key={`euro-${item.equipmentId || item.equipmentName}`} className="flex justify-between">
                                  <span>{item.equipmentName || item.equipmentId || "Equipamento"}</span>
                                  <span className="text-white/50">x{item.quantity || 0}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-white/40">Sem equipamentos da Base Euro.</div>
                          )}
                          <div className="mt-4 text-[10px] uppercase tracking-[0.12em] text-white/50">Base Cliente</div>
                          {inventoryByOrigin.cliente.length ? (
                            <ul className="mt-2 space-y-1">
                              {inventoryByOrigin.cliente.map((item) => (
                                <li
                                  key={`cliente-${item.equipmentId || item.equipmentName}`}
                                  className="flex justify-between"
                                >
                                  <span>{item.equipmentName || item.equipmentId || "Equipamento"}</span>
                                  <span className="text-white/50">x{item.quantity || 0}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="mt-2 text-white/40">Sem equipamentos da Base do Cliente.</div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleApproveRequest}
                        disabled={saving}
                        className="w-full rounded-xl bg-emerald-400/90 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-300 disabled:opacity-60"
                      >
                        Confirmar aprovação
                      </button>
                    </div>
                  </div>
                  {actionError && <div className="text-xs text-red-200">{actionError}</div>}
                </div>
              )}

              {actionMode === "reschedule" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingInput
                    label="Nova data do serviço"
                    type="datetime-local"
                    value={actionDate}
                    onChange={(event) => setActionDate(event.target.value)}
                  />
                  <FloatingField label="Técnico (opcional)">
                    <AutocompleteSelect
                      label={null}
                      placeholder={techniciansLoading ? "Carregando técnicos..." : "Selecione o técnico"}
                      value={actionTechnician}
                      options={technicianAutocompleteOptions}
                      loadOptions={loadTechnicianOptions}
                      onChange={(value) => setActionTechnician(value || "")}
                      allowClear
                      disabled={techniciansLoading}
                      inputClassName={FIELD_INPUT_CLASS}
                    />
                  </FloatingField>
                  <FloatingInput
                    label="Motivo (opcional)"
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                    placeholder="Descreva o motivo"
                    className="md:col-span-2"
                  />
                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleRescheduleRequest}
                      disabled={saving}
                      className="rounded-xl bg-amber-300/90 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-amber-200 disabled:opacity-60"
                    >
                      Confirmar reagendamento
                    </button>
                  </div>
                  {actionError && <div className="text-xs text-red-200">{actionError}</div>}
                </div>
              )}

              {actionMode === "cancel" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <FloatingInput
                    label="Motivo (opcional)"
                    value={actionReason}
                    onChange={(event) => setActionReason(event.target.value)}
                    placeholder="Descreva o motivo"
                  />
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleCancelRequest}
                      disabled={saving}
                      className="w-full rounded-xl bg-red-400/90 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-red-300 disabled:opacity-60"
                    >
                      Confirmar cancelamento
                    </button>
                  </div>
                  {actionError && <div className="text-xs text-red-200">{actionError}</div>}
                </div>
              )}
            </section>
          ) : null}

          {activeTab === "transfer" && editingId ? (
            <section className="space-y-6">
              <h3 className="text-xs uppercase tracking-[0.14em] text-white/50">Transferir Equipamento</h3>
              {!form.assignedTechnicianId ? (
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                  Aprove a solicitação para liberar a transferência de equipamento ao técnico.
                </div>
              ) : null}

              {isInternalUser ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setEquipmentOrigin("euro")}
                      className={`rounded-full px-3 py-1 ${
                        equipmentOrigin === "euro" ? "bg-sky-500 text-black" : "bg-white/10 text-white/70"
                      }`}
                    >
                      Base Euro
                    </button>
                    <button
                      type="button"
                      onClick={() => setEquipmentOrigin("cliente")}
                      className={`rounded-full px-3 py-1 ${
                        equipmentOrigin === "cliente" ? "bg-sky-500 text-black" : "bg-white/10 text-white/70"
                      }`}
                    >
                      Base do Cliente
                    </button>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FloatingField label="Equipamento (catálogo)">
                      <select
                        className={FIELD_INPUT_CLASS}
                        value={transferEquipmentId}
                        onChange={(event) => {
                          setTransferEquipmentId(event.target.value);
                          setTransferEquipmentName("");
                        }}
                      >
                        <option value="">
                          {equipmentLoading ? "Carregando..." : "Selecione um equipamento"}
                        </option>
                        {equipmentOptions.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name || item.type || item.id}
                          </option>
                        ))}
                      </select>
                    </FloatingField>
                    <FloatingInput
                      label="Descrição (opcional)"
                      value={transferEquipmentName}
                      onChange={(event) => setTransferEquipmentName(event.target.value)}
                      placeholder="Ex: Módulo X"
                    />
                    <FloatingInput
                      label="Quantidade"
                      type="number"
                      min="1"
                      value={transferQuantity}
                      onChange={(event) => setTransferQuantity(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleTransferEquipment}
                      disabled={saving || !form.assignedTechnicianId}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-sky-400 disabled:opacity-60"
                    >
                      Transferir para técnico
                    </button>
                    {selectionError && <span className="text-xs text-red-200">{selectionError}</span>}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/70">
                    <div className="font-semibold text-white">Histórico de transferências</div>
                    {transferLog.length ? (
                      <ul className="mt-2 space-y-1">
                        {transferLog.map((item) => (
                          <li key={item.id} className="flex justify-between">
                            <span>
                              {item.equipmentName || item.equipmentId || "Equipamento"} ({item.origin === "euro" ? "Base Euro" : "Base Cliente"})
                            </span>
                            <span className="text-white/50">
                              x{item.quantity || 0} • {formatDate(item.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="mt-2 text-white/40">Nenhuma transferência registrada.</div>
                    )}
                  </div>

                  {["aprovado_aguardando_equipamento", "aprovado", "reagendado", "remanejado", "remarcado"].includes(
                    String(form.status || ""),
                  ) ? (
                    <button
                      type="button"
                      onClick={handleConfirmService}
                      disabled={saving}
                      className="rounded-xl bg-emerald-400/90 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-300 disabled:opacity-60"
                    >
                      Confirmar equipamento e aprovar serviço
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                    Selecione os equipamentos disponíveis com o técnico para este atendimento.
                  </div>
                  {inventoryLoading ? (
                    <div className="text-sm text-white/60">Carregando equipamentos...</div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Base Euro</div>
                        {inventoryByOrigin.euro.length ? (
                          <div className="mt-2 space-y-2">
                            {inventoryByOrigin.euro.map((item) => {
                              const key = `${item.origin || ""}:${item.equipmentId || item.equipmentName || ""}`;
                              return (
                                <label
                                  key={`sel-euro-${item.equipmentId || item.equipmentName}`}
                                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedEquipmentKeys.has(key)}
                                    onChange={() => toggleEquipmentSelection(item)}
                                  />
                                  <span className="flex-1">
                                    {item.equipmentName || item.equipmentId || "Equipamento"}
                                  </span>
                                  <span className="text-xs text-white/50">x{item.quantity || 0}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-white/40">Sem equipamentos disponíveis.</div>
                        )}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.12em] text-white/50">Base Cliente</div>
                        {inventoryByOrigin.cliente.length ? (
                          <div className="mt-2 space-y-2">
                            {inventoryByOrigin.cliente.map((item) => {
                              const key = `${item.origin || ""}:${item.equipmentId || item.equipmentName || ""}`;
                              return (
                                <label
                                  key={`sel-cliente-${item.equipmentId || item.equipmentName}`}
                                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/80"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedEquipmentKeys.has(key)}
                                    onChange={() => toggleEquipmentSelection(item)}
                                  />
                                  <span className="flex-1">
                                    {item.equipmentName || item.equipmentId || "Equipamento"}
                                  </span>
                                  <span className="text-xs text-white/50">x{item.quantity || 0}</span>
                                </label>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-white/40">Sem equipamentos disponíveis.</div>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSaveEquipmentSelection}
                      disabled={saving}
                      className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-sky-400 disabled:opacity-60"
                    >
                      Salvar seleção
                    </button>
                    {selectionError && <span className="text-xs text-red-200">{selectionError}</span>}
                  </div>
                </>
              )}
            </section>
          ) : null}

          <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#0f141c] pt-4">
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white"
            >
              Fechar
            </button>
            {activeTab === "details" ? (
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-70"
              >
                {saving ? "Salvando…" : editingId ? "Atualizar" : "Salvar"}
              </button>
            ) : null}
          </div>
        </form>
      </Drawer>
    </div>
  );
}
