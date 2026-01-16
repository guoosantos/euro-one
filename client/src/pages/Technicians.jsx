import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../components/ui/PageHeader.jsx";
import DataTable from "../components/ui/DataTable.jsx";
import EmptyState from "../components/ui/EmptyState.jsx";
import AddressSearchInput, { useAddressSearchState } from "../components/shared/AddressSearchInput.jsx";
import api from "../lib/api.js";
import { CoreApi } from "../lib/coreApi.js";
import { useTenant } from "../lib/tenant-context.jsx";

const STATUS_OPTIONS = [
  { value: "ativo", label: "Ativo" },
  { value: "inativo", label: "Inativo" },
];

const TYPE_OPTIONS = [
  { value: "interno", label: "Interno" },
  { value: "terceirizado", label: "Terceirizado" },
];

const PROFILE_OPTIONS = [
  { value: "Técnico Completo", label: "Técnico Completo" },
  { value: "Técnico Rastreador", label: "Técnico Rastreador" },
  { value: "Socorrista", label: "Socorrista" },
];

const EQUIPMENT_STATUS_FILTERS = [
  { key: "disponivel", label: "Disponíveis" },
  { key: "retirado", label: "Retirados" },
  { key: "funcionando", label: "Funcionando" },
  { key: "danificado", label: "Danificados" },
];

const defaultForm = {
  name: "",
  email: "",
  phone: "",
  status: "ativo",
  type: "interno",
  profile: "Técnico Completo",
  addressSearch: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  zip: "",
  latitude: "",
  longitude: "",
  clientId: "",
};

function Drawer({ open, onClose, title, description, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[9998] flex">
      <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-3xl border-l border-white/10 bg-[#0f141c] shadow-3xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-white/50">Cadastro técnico</p>
            <h2 className="text-xl font-semibold text-white">{title}</h2>
            {description && <p className="text-sm text-white/60">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>
        <div className="h-[calc(100%-80px)] overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveEquipmentStatus(device) {
  const raw = normalizeText(
    device?.attributes?.status ||
      device?.status ||
      device?.statusLabel ||
      device?.connectionStatusLabel ||
      device?.usageStatusLabel,
  );
  if (raw.includes("danific")) return "danificado";
  if (raw.includes("retir")) return "retirado";
  if (raw.includes("dispon")) return "disponivel";
  if (raw.includes("funcion")) return "funcionando";
  if (!device?.vehicleId || device?.usageStatus === "stock") return "disponivel";
  return "funcionando";
}

function getDeviceTechnicianReference(device) {
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function buildEquipmentLabels(item) {
  const list = Array.isArray(item?.equipmentsData) ? item.equipmentsData : null;
  if (list && list.length) {
    return list
      .map((equipment) => {
        const id = equipment?.equipmentId || equipment?.id || "";
        const model = equipment?.model || equipment?.name || "";
        if (model && id) return `${model} • ${id}`;
        return model || id;
      })
      .filter(Boolean);
  }
  if (item?.equipmentsText) {
    return [String(item.equipmentsText)];
  }
  return [];
}

export default function Technicians() {
  const navigate = useNavigate();
  const { tenantId, tenants, hasAdminAccess, user } = useTenant();
  const [items, setItems] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingLogin, setSavingLogin] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("cadastro");
  const [form, setForm] = useState(defaultForm);
  const [loginForm, setLoginForm] = useState({ username: "", email: "", password: "" });
  const [loginConfigured, setLoginConfigured] = useState(false);
  const [equipmentStatusFilter, setEquipmentStatusFilter] = useState([]);
  const [modelFilter, setModelFilter] = useState("all");
  const [equipmentModelFilter, setEquipmentModelFilter] = useState("all");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersSearch, setOrdersSearch] = useState("");
  const [radiusKm, setRadiusKm] = useState("10");
  const [radiusCandidate, setRadiusCandidate] = useState(null);
  const [radiusApplied, setRadiusApplied] = useState(null);

  const addressSearchState = useAddressSearchState({ initialValue: "" });
  const radiusSearchState = useAddressSearchState({ initialValue: "" });

  const resolvedClientId = hasAdminAccess
    ? form.clientId || tenantId || tenants[0]?.id || ""
    : tenantId || user?.clientId || "";

  useEffect(() => {
    if (!drawerOpen) return;
    addressSearchState.resetSuggestions();
  }, [addressSearchState, drawerOpen]);

  const clientNameById = useMemo(() => {
    const map = new Map();
    (tenants || []).forEach((tenant) => {
      map.set(String(tenant.id), tenant.name || tenant.company || tenant.id);
    });
    return map;
  }, [tenants]);

  const technicianNameMap = useMemo(() => {
    const map = new Map();
    items.forEach((technician) => {
      map.set(normalizeText(technician.name), String(technician.id));
    });
    return map;
  }, [items]);

  const devicesByTechnician = useMemo(() => {
    const map = new Map();
    items.forEach((technician) => {
      map.set(String(technician.id), []);
    });

    devices.forEach((device) => {
      const ref = getDeviceTechnicianReference(device);
      let targetId = null;
      if (ref.id && map.has(String(ref.id))) {
        targetId = String(ref.id);
      } else if (ref.name) {
        targetId = technicianNameMap.get(normalizeText(ref.name)) || null;
      }
      if (!targetId) return;
      const bucket = map.get(String(targetId));
      if (bucket) {
        bucket.push(device);
      }
    });

    return map;
  }, [devices, items, technicianNameMap]);

  const assignedDevices = useMemo(
    () => Array.from(devicesByTechnician.values()).flat(),
    [devicesByTechnician],
  );

  const modelCounts = useMemo(() => {
    const counts = new Map();
    assignedDevices.forEach((device) => {
      const model = device.modelName || device.model || device.modelId || "Sem modelo";
      const key = String(model);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [assignedDevices]);

  const modelPills = useMemo(() => {
    const entries = Array.from(modelCounts.entries()).map(([label, count]) => ({ label, count }));
    entries.sort((a, b) => a.label.localeCompare(b.label));
    return entries;
  }, [modelCounts]);

  const technicianEquipmentStatus = useMemo(() => {
    const map = new Map();
    devicesByTechnician.forEach((devicesList, technicianId) => {
      const statuses = new Set();
      devicesList.forEach((device) => {
        statuses.add(resolveEquipmentStatus(device));
      });
      map.set(technicianId, statuses);
    });
    return map;
  }, [devicesByTechnician]);

  const equipmentSummaryByTechnician = useMemo(() => {
    const map = new Map();
    devicesByTechnician.forEach((devicesList, technicianId) => {
      const counts = new Map();
      devicesList.forEach((device) => {
        const status = resolveEquipmentStatus(device);
        if (status !== "disponivel" && status !== "funcionando") return;
        const model = device.modelName || device.model || device.modelId || "Sem modelo";
        const key = String(model);
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      const summary = Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([model, count]) => `${model}: ${count}`)
        .join(" • ");
      map.set(String(technicianId), summary || "—");
    });
    return map;
  }, [devicesByTechnician]);

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filters = equipmentStatusFilter;
    return items.filter((item) => {
      const haystack = [item.name, item.email, item.phone, item.city, item.state, item.status]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (term && !haystack.includes(term)) return false;

      if (radiusApplied) {
        const lat = Number(item.latitude);
        const lng = Number(item.longitude);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
        if (radiusApplied.lat != null && radiusApplied.lng != null && hasCoords) {
          const radians = (deg) => (deg * Math.PI) / 180;
          const earthRadiusKm = 6371;
          const dLat = radians(lat - radiusApplied.lat);
          const dLng = radians(lng - radiusApplied.lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(radians(radiusApplied.lat)) * Math.cos(radians(lat)) * Math.sin(dLng / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          const distance = earthRadiusKm * c;
          if (distance > radiusApplied.radiusKm) return false;
        } else {
          const cityMatch =
            radiusApplied.city && normalizeText(radiusApplied.city) === normalizeText(item.city);
          const stateMatch =
            radiusApplied.state && normalizeText(radiusApplied.state) === normalizeText(item.state);
          const zipMatch = radiusApplied.zip && normalizeText(radiusApplied.zip) === normalizeText(item.zip);
          if (!cityMatch && !stateMatch && !zipMatch) return false;
        }
      }

      if (filters.length) {
        const statuses = technicianEquipmentStatus.get(String(item.id)) || new Set();
        const matchesStatus = filters.some((status) => statuses.has(status));
        if (!matchesStatus) return false;
      }

      if (modelFilter !== "all") {
        const list = devicesByTechnician.get(String(item.id)) || [];
        const hasModel = list.some((device) => {
          const model = device.modelName || device.model || device.modelId || "Sem modelo";
          return String(model) === modelFilter;
        });
        if (!hasModel) return false;
      }

      return true;
    });
  }, [devicesByTechnician, equipmentStatusFilter, items, modelFilter, radiusApplied, search, technicianEquipmentStatus]);

  const selectedTechnician = useMemo(
    () => items.find((technician) => String(technician.id) === String(editingId)) || null,
    [editingId, items],
  );

  const selectedTechnicianDevices = useMemo(
    () => (selectedTechnician ? devicesByTechnician.get(String(selectedTechnician.id)) || [] : []),
    [devicesByTechnician, selectedTechnician],
  );

  const technicianModelPills = useMemo(() => {
    const counts = new Map();
    selectedTechnicianDevices.forEach((device) => {
      const model = device.modelName || device.model || device.modelId || "Sem modelo";
      const key = String(model);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selectedTechnicianDevices]);

  const filteredTechnicianDevices = useMemo(() => {
    const term = normalizeText(equipmentSearch);
    return selectedTechnicianDevices.filter((device) => {
      const model = device.modelName || device.model || device.modelId || "Sem modelo";
      if (equipmentModelFilter !== "all" && String(model) !== equipmentModelFilter) return false;
      if (!term) return true;
      const haystack = [device.id, device.uniqueId, device.name, model]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [equipmentModelFilter, equipmentSearch, selectedTechnicianDevices]);

  const filteredOrders = useMemo(() => {
    const term = normalizeText(ordersSearch);
    const technicianName = normalizeText(selectedTechnician?.name);
    return orders.filter((order) => {
      const matchesTech = technicianName
        ? normalizeText(order.technicianName) === technicianName
        : true;
      if (!matchesTech) return false;
      if (!term) return true;
      const haystack = [order.osInternalId, order.vehicle?.plate, order.vehicle?.name, order.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [orders, ordersSearch, selectedTechnician?.name]);

  const resetForm = () => {
    setEditingId(null);
    setForm((prev) => ({
      ...defaultForm,
      clientId: hasAdminAccess ? prev.clientId || resolvedClientId : prev.clientId,
    }));
    addressSearchState.setQuery("");
    setLoginForm({ username: "", email: "", password: "" });
    setLoginConfigured(false);
    setDrawerTab("cadastro");
    setDrawerOpen(true);
  };

  const loadTechnicians = async (clientId) => {
    setLoading(true);
    setError(null);
    try {
      const params = clientId ? { clientId } : undefined;
      const response = await api.get("core/technicians", { params });
      const list = response?.data?.items || [];
      setItems(Array.isArray(list) ? list : []);
    } catch (loadError) {
      console.error("Falha ao carregar técnicos", loadError);
      setError(loadError);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const loadDevices = async (clientId) => {
    setDevicesLoading(true);
    try {
      const params = clientId ? { clientId } : undefined;
      const list = await CoreApi.listDevices(params);
      setDevices(Array.isArray(list) ? list : []);
    } catch (deviceError) {
      console.error("Falha ao carregar equipamentos", deviceError);
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  };

  const loadOrders = async (clientId, technicianName) => {
    if (!technicianName) return;
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams();
      if (clientId) params.set("clientId", clientId);
      if (technicianName) params.set("q", technicianName);
      const response = await api.get("core/service-orders", { params });
      setOrders(response?.data?.items || []);
    } catch (ordersError) {
      console.error("Falha ao carregar OS do técnico", ordersError);
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  useEffect(() => {
    if (!resolvedClientId && hasAdminAccess) return;
    loadTechnicians(resolvedClientId);
    loadDevices(resolvedClientId);
  }, [resolvedClientId, hasAdminAccess]);

  useEffect(() => {
    if (!drawerOpen || !editingId || drawerTab !== "ordens") return;
    const clientId = selectedTechnician?.clientId || resolvedClientId || null;
    loadOrders(clientId, selectedTechnician?.name);
  }, [drawerOpen, drawerTab, editingId, resolvedClientId, selectedTechnician?.clientId, selectedTechnician?.name]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        status: form.status,
        type: form.type,
        profile: form.profile,
        addressSearch: addressSearchState.query.trim(),
        street: form.street.trim(),
        number: form.number.trim(),
        complement: form.complement.trim(),
        district: form.district.trim(),
        zip: form.zip.trim(),
        latitude: form.latitude,
        longitude: form.longitude,
        clientId: hasAdminAccess ? resolvedClientId : undefined,
      };

      if (!payload.name || !payload.email) {
        throw new Error("Nome e e-mail são obrigatórios");
      }

      if (editingId) {
        await api.put(`core/technicians/${editingId}`, payload);
        setMessage("Técnico atualizado com sucesso.");
      } else {
        await api.post("core/technicians", payload);
        setMessage("Técnico criado com sucesso.");
      }

      setDrawerOpen(false);
      loadTechnicians(resolvedClientId);
    } catch (submitError) {
      console.error("Falha ao salvar técnico", submitError);
      setError(submitError);
    } finally {
      setSaving(false);
    }
  };

  const handleLoginSave = async () => {
    if (!editingId) return;
    if (!loginForm.password) {
      setMessage("Informe uma senha para o técnico.");
      return;
    }
    setSavingLogin(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        username: loginForm.username.trim() || undefined,
        email: loginForm.email.trim() || undefined,
        password: loginForm.password,
        clientId: selectedTechnician?.clientId || resolvedClientId || undefined,
      };
      const response = await api.post(`core/technicians/${editingId}/login`, payload);
      if (!response?.data?.ok) {
        throw new Error(response?.data?.message || "Falha ao salvar login");
      }
      setLoginConfigured(true);
      setLoginForm((prev) => ({ ...prev, password: "" }));
      setMessage("Credenciais atualizadas com sucesso.");
      loadTechnicians(resolvedClientId);
    } catch (loginError) {
      console.error("Falha ao atualizar login", loginError);
      setError(loginError);
    } finally {
      setSavingLogin(false);
    }
  };

  const handleEdit = (technician) => {
    setEditingId(technician.id);
    setForm({
      name: technician.name || "",
      email: technician.email || "",
      phone: technician.phone || "",
      status: technician.status || "ativo",
      type: technician.type || "interno",
      profile: technician.profile || "Técnico Completo",
      addressSearch: technician.addressSearch || "",
      street: technician.street || "",
      number: technician.number || "",
      complement: technician.complement || "",
      district: technician.district || "",
      city: technician.city || "",
      state: technician.state || "",
      zip: technician.zip || "",
      latitude: technician.latitude ?? "",
      longitude: technician.longitude ?? "",
      clientId: technician.clientId || resolvedClientId,
    });
    addressSearchState.setQuery(technician.addressSearch || "");
    setLoginForm({
      username: technician.username || "",
      email: technician.email || "",
      password: "",
    });
    const resolvedLoginConfigured =
      technician.loginConfigured === null || technician.loginConfigured === undefined
        ? Boolean(technician.email)
        : Boolean(technician.loginConfigured);
    setLoginConfigured(resolvedLoginConfigured);
    setDrawerTab("cadastro");
    setDrawerOpen(true);
  };

  const handleSelectAddress = (option) => {
    if (!option) return;
    const address = option.raw?.address || {};
    setForm((prev) => ({
      ...prev,
      addressSearch: option.concise || option.label || prev.addressSearch,
      street: address.road || address.street || prev.street,
      number: address.house_number || prev.number,
      complement: prev.complement,
      district: address.suburb || address.neighbourhood || address.city_district || address.county || prev.district,
      city: address.city || address.town || address.village || address.municipality || address.county || prev.city,
      state: address.state || address.state_code || prev.state,
      zip: address.postcode || prev.zip,
      latitude: option.lat ?? prev.latitude,
      longitude: option.lng ?? prev.longitude,
    }));
  };

  const handleSelectRadius = (option) => {
    if (!option) return;
    const address = option.raw?.address || {};
    setRadiusCandidate({
      lat: option.lat ?? null,
      lng: option.lng ?? null,
      city: address.city || address.town || address.village || address.municipality || "",
      state: address.state || address.state_code || "",
      zip: address.postcode || "",
      label: option.concise || option.label || "",
    });
  };

  const applyRadiusFilter = async () => {
    if (!radiusCandidate && !radiusSearchState.query.trim()) {
      setRadiusApplied(null);
      return;
    }
    let candidate = radiusCandidate;
    if (!candidate && radiusSearchState.query.trim()) {
      const result = await radiusSearchState.onSubmit?.();
      if (result) {
        const address = result.raw?.address || {};
        candidate = {
          lat: result.lat ?? null,
          lng: result.lng ?? null,
          city: address.city || address.town || address.village || address.municipality || "",
          state: address.state || address.state_code || "",
          zip: address.postcode || "",
          label: result.concise || result.label || radiusSearchState.query,
        };
      }
    }
    if (!candidate) {
      setRadiusApplied(null);
      return;
    }
    const radiusValue = Number(radiusKm) || 0;
    setRadiusApplied({
      lat: candidate.lat ?? null,
      lng: candidate.lng ?? null,
      city: candidate.city || "",
      state: candidate.state || "",
      zip: candidate.zip || "",
      label: candidate.label || radiusSearchState.query,
      radiusKm: radiusValue || 0,
      fallback: candidate.lat == null || candidate.lng == null,
    });
  };

  const clearRadiusFilter = () => {
    radiusSearchState.onClear();
    setRadiusCandidate(null);
    setRadiusApplied(null);
  };

  useEffect(() => {
    if (radiusSearchState.query.trim()) return;
    setRadiusCandidate(null);
    setRadiusApplied(null);
  }, [radiusSearchState.query]);

  const toggleEquipmentStatus = (key) => {
    setEquipmentStatusFilter((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Técnico"
        subtitle="Cadastre e gerencie técnicos disponíveis para ordens de serviço."
        actions={
          <button
            type="button"
            onClick={resetForm}
            className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
          >
            Novo técnico
          </button>
        }
      />

      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-xs text-white/60">
            Buscar por nome, e-mail ou cidade
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              placeholder="Buscar técnico"
            />
          </label>
          <div className="min-w-[280px] flex-1">
            <span className="block text-xs text-white/60">Buscar endereço</span>
            <div className="mt-2">
              <AddressSearchInput
                state={radiusSearchState}
                onSelect={handleSelectRadius}
                onClear={() => setRadiusCandidate(null)}
                placeholder="Buscar endereço"
                variant="toolbar"
                containerClassName="w-full"
              />
            </div>
          </div>
          <label className="block text-xs text-white/60">
            Raio (km)
            <input
              type="number"
              value={radiusKm}
              onChange={(event) => setRadiusKm(event.target.value)}
              className="mt-2 w-32 rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              min="0"
            />
          </label>
          <button
            type="button"
            onClick={applyRadiusFilter}
            className="h-10 rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={clearRadiusFilter}
            className="h-10 rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
          >
            Limpar filtro
          </button>
          <button
            type="button"
            onClick={() => {
              loadTechnicians(resolvedClientId);
              loadDevices(resolvedClientId);
            }}
            className="h-10 rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
          >
            Atualizar
          </button>
        </div>
        {radiusApplied?.fallback && (
          <p className="text-xs text-amber-200/80">
            Filtro por raio usando cidade/UF/CEP (aproximação), pois não há coordenadas suficientes.
          </p>
        )}

        <div className="space-y-2">
          <span className="block text-xs uppercase tracking-[0.14em] text-white/50">
            Status dos equipamentos
          </span>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_STATUS_FILTERS.map((option) => {
              const active = equipmentStatusFilter.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleEquipmentStatus(option.key)}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    active
                      ? "bg-sky-500/20 text-white border border-sky-400/60"
                      : "border border-white/10 bg-white/5 text-white/70"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="block text-xs uppercase tracking-[0.14em] text-white/50">Modelos</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setModelFilter("all")}
              className={`rounded-full px-3 py-1 text-xs transition ${
                modelFilter === "all"
                  ? "bg-sky-500/20 text-white border border-sky-400/60"
                  : "border border-white/10 bg-white/5 text-white/70"
              }`}
            >
              Todos ({assignedDevices.length})
            </button>
            {modelPills.map((model) => (
              <button
                key={model.label}
                type="button"
                onClick={() => setModelFilter(model.label)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  modelFilter === model.label
                    ? "bg-sky-500/20 text-white border border-sky-400/60"
                    : "border border-white/10 bg-white/5 text-white/70"
                }`}
              >
                {model.label} ({model.count})
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="overflow-hidden">
          <DataTable>
            <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Perfil</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Cidade/UF</th>
                <th className="px-4 py-3">Equipamentos</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {(loading || devicesLoading) && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-sm text-white/70">
                    Carregando técnicos...
                  </td>
                </tr>
              )}
              {!loading && !devicesLoading && filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <EmptyState
                      title="Nenhum técnico encontrado."
                      subtitle="Cadastre um técnico para usar nas ordens de serviço."
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                !devicesLoading &&
                filteredItems.map((technician) => (
                  <tr key={technician.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-white">{technician.name}</td>
                    <td className="px-4 py-3 text-white/70">{technician.profile || "—"}</td>
                    <td className="px-4 py-3 text-white/70">{technician.phone || "—"}</td>
                    <td className="px-4 py-3 text-white/70">
                      {[technician.city, technician.state].filter(Boolean).join("/") || "—"}
                    </td>
                    <td className="px-4 py-3 text-white/70">
                      {equipmentSummaryByTechnician.get(String(technician.id)) || "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEdit(technician)}
                        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white transition hover:border-white/30"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </div>
      </div>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editingId ? "Editar técnico" : "Novo técnico"}
        description="Complete cadastro, login, equipamentos e OS em um fluxo lateral."
      >
        <div className="flex gap-2 overflow-x-auto pb-2 text-[11px] uppercase tracking-[0.1em] text-white/60">
          {[
            { key: "cadastro", label: "Cadastro" },
            { key: "login", label: "Login" },
            { key: "equipamentos", label: "Equipamentos" },
            { key: "ordens", label: "Ordem de Serviço" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDrawerTab(tab.key)}
              className={`rounded-md px-3 py-2 transition ${
                drawerTab === tab.key
                  ? "bg-primary/20 text-white border border-primary/40"
                  : "border border-transparent hover:border-white/20"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {drawerTab === "cadastro" && (
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <label className="block text-xs text-white/60">
              Nome *
              <input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                required
              />
            </label>
            <label className="block text-xs text-white/60">
              E-mail/Login *
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                required
              />
            </label>
            <label className="block text-xs text-white/60">
              Telefone
              <input
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Tipo
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
              <label className="block text-xs text-white/60">
                Status
                <select
                  value={form.status}
                  onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-white/60">
                Perfil
                <select
                  value={form.profile}
                  onChange={(event) => setForm((prev) => ({ ...prev, profile: event.target.value }))}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {PROFILE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="md:col-span-2">
              <span className="block text-xs text-white/60">Buscar endereço</span>
              <div className="mt-2">
                <AddressSearchInput
                  state={addressSearchState}
                  onSelect={handleSelectAddress}
                  placeholder="Buscar endereço"
                  variant="toolbar"
                  containerClassName="w-full"
                />
              </div>
            </div>

            <label className="block text-xs text-white/60">
              Rua
              <input
                value={form.street}
                onChange={(event) => setForm((prev) => ({ ...prev, street: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Número
              <input
                value={form.number}
                onChange={(event) => setForm((prev) => ({ ...prev, number: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Complemento
              <input
                value={form.complement}
                onChange={(event) => setForm((prev) => ({ ...prev, complement: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Bairro
              <input
                value={form.district}
                onChange={(event) => setForm((prev) => ({ ...prev, district: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Cidade
              <input
                value={form.city}
                onChange={(event) => setForm((prev) => ({ ...prev, city: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              UF
              <input
                value={form.state}
                onChange={(event) => setForm((prev) => ({ ...prev, state: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              CEP
              <input
                value={form.zip}
                onChange={(event) => setForm((prev) => ({ ...prev, zip: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Latitude
              <input
                value={form.latitude}
                onChange={(event) => setForm((prev) => ({ ...prev, latitude: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            <label className="block text-xs text-white/60">
              Longitude
              <input
                value={form.longitude}
                onChange={(event) => setForm((prev) => ({ ...prev, longitude: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              />
            </label>
            {hasAdminAccess && (
              <label className="block text-xs text-white/60 md:col-span-2">
                Cliente
                <select
                  value={resolvedClientId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setForm((prev) => ({ ...prev, clientId: nextId }));
                  }}
                  className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                >
                  {tenants.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-3">
              {error && <span className="text-sm text-red-300">{error?.response?.data?.message || error.message}</span>}
              {message && <span className="text-sm text-emerald-300">{message}</span>}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white transition hover:border-white/30"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
              >
                {saving ? "Salvando..." : editingId ? "Atualizar técnico" : "Cadastrar técnico"}
              </button>
            </div>
          </form>
        )}

        {drawerTab === "login" && (
          <div className="space-y-4">
            {!editingId && (
              <EmptyState title="Salve o cadastro antes de configurar o login." subtitle="Crie o técnico e depois ajuste credenciais." />
            )}
            {editingId && (
              <div className="space-y-3">
                <div className="rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                  {loginConfigured
                    ? "Login já configurado. Você pode redefinir a senha abaixo."
                    : "Login ainda não configurado. Defina usuário e senha para acessar."}
                </div>
                <label className="block text-xs text-white/60">
                  Usuário
                  <input
                    value={loginForm.username}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, username: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                    placeholder="Ex.: tecnico.jose"
                  />
                </label>
                <label className="block text-xs text-white/60">
                  Email
                  <input
                    type="email"
                    value={loginForm.email}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <label className="block text-xs text-white/60">
                  Senha
                  <input
                    type="password"
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                  />
                </label>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleLoginSave}
                    disabled={savingLogin}
                    className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
                  >
                    {savingLogin ? "Salvando..." : "Salvar login"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {drawerTab === "equipamentos" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="block text-xs uppercase tracking-[0.14em] text-white/50">Modelos</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEquipmentModelFilter("all")}
                  className={`rounded-full px-3 py-1 text-xs transition ${
                    equipmentModelFilter === "all"
                      ? "bg-sky-500/20 text-white border border-sky-400/60"
                      : "border border-white/10 bg-white/5 text-white/70"
                  }`}
                >
                  Todos ({selectedTechnicianDevices.length})
                </button>
                {technicianModelPills.map((model) => (
                  <button
                    key={model.label}
                    type="button"
                    onClick={() => setEquipmentModelFilter(model.label)}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      equipmentModelFilter === model.label
                        ? "bg-sky-500/20 text-white border border-sky-400/60"
                        : "border border-white/10 bg-white/5 text-white/70"
                    }`}
                  >
                    {model.label} ({model.count})
                  </button>
                ))}
              </div>
            </div>

            <label className="block text-xs text-white/60">
              Buscar ID do equipamento
              <input
                value={equipmentSearch}
                onChange={(event) => setEquipmentSearch(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Buscar ID do equipamento"
              />
            </label>

            {selectedTechnicianDevices.length === 0 ? (
              <EmptyState title="Nenhum equipamento vinculado ao técnico." />
            ) : (
              <div className="grid gap-3">
                {filteredTechnicianDevices.map((device) => {
                  const statusKey = resolveEquipmentStatus(device);
                  const statusLabel =
                    EQUIPMENT_STATUS_FILTERS.find((option) => option.key === statusKey)?.label || "Disponível";
                  const statusTone =
                    statusKey === "danificado"
                      ? "bg-rose-500/20 text-rose-100 border-rose-500/40"
                      : statusKey === "retirado"
                      ? "bg-amber-500/20 text-amber-100 border-amber-500/40"
                      : statusKey === "funcionando"
                      ? "bg-emerald-500/20 text-emerald-100 border-emerald-500/40"
                      : "bg-white/10 text-white/80 border-white/20";

                  const movementType = device?.attributes?.technicianMovementType || "—";
                  const movementDate =
                    device?.attributes?.technicianMovementAt ||
                    device?.attributes?.technicianAssignedAt ||
                    device?.updatedAt ||
                    null;

                  return (
                    <div key={device.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-white">{device.id}</div>
                        <span className={`rounded-full border px-3 py-1 text-xs ${statusTone}`}>{statusLabel}</span>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs text-white/70 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Modelo</div>
                          <div className="text-sm text-white">{device.modelName || device.model || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Cliente dono</div>
                          <div className="text-sm text-white">
                            {clientNameById.get(String(device.clientId)) || "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Data de entrega</div>
                          <div className="text-sm text-white">{formatDate(movementDate)}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Movimentação</div>
                          <div className="text-sm text-white">{movementType || "—"}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {drawerTab === "ordens" && (
          <div className="space-y-4">
            <label className="block text-xs text-white/60">
              Buscar OS por ID, número ou placa
              <input
                value={ordersSearch}
                onChange={(event) => setOrdersSearch(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Buscar por ID/placa"
              />
            </label>
            {ordersLoading && (
              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70">
                Carregando ordens de serviço...
              </div>
            )}
            {!ordersLoading && filteredOrders.length === 0 && (
              <EmptyState title="Nenhuma OS encontrada para este técnico." />
            )}
            {!ordersLoading && filteredOrders.length > 0 && (
              <div className="grid gap-3">
                {filteredOrders.map((order) => {
                  const equipmentLabels = buildEquipmentLabels(order);
                  const vehicle = order.vehicle || {};
                  return (
                    <button
                      type="button"
                      key={order.id}
                      onClick={() => navigate(`/services/${order.id}`)}
                      className="rounded-xl border border-white/10 bg-black/30 p-4 text-left transition hover:border-white/30"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-sm text-white">
                          {order.osInternalId || order.id}
                        </div>
                        <div className="text-xs text-white/60">{formatDate(order.startAt || order.createdAt)}</div>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs text-white/70 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Placa</div>
                          <div className="text-sm text-white">{vehicle.plate || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Marca</div>
                          <div className="text-sm text-white">{vehicle.brand || order.vehicleBrand || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Modelo</div>
                          <div className="text-sm text-white">{vehicle.name || order.vehicleModel || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Cor</div>
                          <div className="text-sm text-white">{vehicle.color || order.vehicleColor || "—"}</div>
                        </div>
                        <div className="md:col-span-2">
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Equipamentos</div>
                          {equipmentLabels.length ? (
                            <div className="mt-1 flex flex-wrap gap-2">
                              {equipmentLabels.map((label, index) => (
                                <span
                                  key={`${order.id}-equip-${index}`}
                                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-sm text-white">—</div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
