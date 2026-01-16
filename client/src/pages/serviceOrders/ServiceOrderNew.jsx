import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import PageHeader from "../../components/ui/PageHeader.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import AddressSearchInput, { useAddressSearchState } from "../../components/shared/AddressSearchInput.jsx";
import VehicleSelector from "../../components/VehicleSelector.jsx";
import AutocompleteSelect from "../../components/ui/AutocompleteSelect.jsx";
import api from "../../lib/api.js";
import { CoreApi } from "../../lib/coreApi.js";
import useVehicles from "../../lib/hooks/useVehicles.js";
import { useTenant } from "../../lib/tenant-context.jsx";

const STATUS_OPTIONS = [
  { value: "SOLICITADA", label: "Solicitada" },
  { value: "AGENDADA", label: "Agendada" },
  { value: "EM_DESLOCAMENTO", label: "Em deslocamento" },
  { value: "EM_EXECUCAO", label: "Em execução" },
  { value: "AGUARDANDO_APROVACAO", label: "Aguardando aprovação" },
  { value: "CONCLUIDA", label: "Concluído" },
  { value: "CANCELADA", label: "Cancelada" },
  { value: "REMANEJADA", label: "Remanejada" },
];

const TYPE_OPTIONS = [
  "Instalação",
  "Manutenção",
  "Retirada",
  "Remanejamento",
  "Socorro",
  "Reinstalação",
];

const CHECKLIST_ITEMS = [
  "Ignição",
  "Rádio",
  "Setas",
  "Farol Alto",
  "Luz Painel",
  "Farol Baixo",
  "Lanternas Traseiras",
  "Lanternas Dianteiras",
  "Limpador Pára-brisa",
  "Iluminação Interna",
  "Ar",
  "Lataria",
  "Inst. Elétrica",
];

function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, d1, d2, d3) => {
      const middle = d2 ? ` ${d2}` : "";
      const end = d3 ? `-${d3}` : "";
      return `(${d1})${middle}${end}`;
    });
  }
  return digits.replace(/(\d{2})(\d{0,5})(\d{0,4})/, (_, d1, d2, d3) => {
    const middle = d2 ? ` ${d2}` : "";
    const end = d3 ? `-${d3}` : "";
    return `(${d1})${middle}${end}`;
  });
}

export default function ServiceOrderNew() {
  const navigate = useNavigate();
  const { tenantId, user, tenants } = useTenant();
  const [saving, setSaving] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);
  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [technicians, setTechnicians] = useState([]);
  const [techniciansLoading, setTechniciansLoading] = useState(false);
  const [technicianId, setTechnicianId] = useState("");
  const [clientSelection, setClientSelection] = useState("");
  const [technicianSignature, setTechnicianSignature] = useState(null);
  const [clientSignature, setClientSignature] = useState(null);
  const technicianCanvasRef = React.useRef(null);
  const clientCanvasRef = React.useRef(null);
  const technicianDrawingRef = React.useRef(false);
  const clientDrawingRef = React.useRef(false);
  const [form, setForm] = useState({
    startAt: "",
    status: "SOLICITADA",
    type: "Instalação",
    technicianName: "",
    clientName: "",
    responsibleName: "",
    responsiblePhone: "",
    addressStart: "",
    address: "",
    addressReturn: "",
    km: "",
    vehicleId: "",
    vehiclePlate: "",
    notes: "",
  });

  const [vehicleSnapshot, setVehicleSnapshot] = useState(null);
  const [equipments, setEquipments] = useState([]);
  const [equipmentQuery, setEquipmentQuery] = useState("");
  const [equipmentDropdownOpen, setEquipmentDropdownOpen] = useState(false);
  const [equipmentHighlightIndex, setEquipmentHighlightIndex] = useState(0);
  const equipmentContainerRef = React.useRef(null);
  const [checklist, setChecklist] = useState(() =>
    CHECKLIST_ITEMS.map((item) => ({ item, before: "", after: "" })),
  );

  const resolvedClientId = tenantId || user?.clientId || null;
  const canManageAll = user?.role === "admin";
  const canSignAsTechnician = user?.role === "technician";
  const canSignAsClient = user?.role === "user";
  const { vehicles } = useVehicles({ includeUnlinked: true });

  const addressStartState = useAddressSearchState({ initialValue: "" });
  const addressServiceState = useAddressSearchState({ initialValue: "" });
  const addressReturnState = useAddressSearchState({ initialValue: "" });

  useEffect(() => {
    if (addressStartState.query !== form.addressStart) {
      setForm((prev) => ({ ...prev, addressStart: addressStartState.query }));
    }
  }, [addressStartState.query, form.addressStart]);

  useEffect(() => {
    if (addressServiceState.query !== form.address) {
      setForm((prev) => ({ ...prev, address: addressServiceState.query }));
    }
  }, [addressServiceState.query, form.address]);

  useEffect(() => {
    if (addressReturnState.query !== form.addressReturn) {
      setForm((prev) => ({ ...prev, addressReturn: addressReturnState.query }));
    }
  }, [addressReturnState.query, form.addressReturn]);

  useEffect(() => {
    const loadDevices = async () => {
      setDevicesLoading(true);
      try {
        const params = resolvedClientId ? { clientId: resolvedClientId } : undefined;
        const list = await CoreApi.listDevices(params);
        setDevices(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error("Falha ao carregar equipamentos", error);
        setDevices([]);
      } finally {
        setDevicesLoading(false);
      }
    };

    loadDevices();
  }, [resolvedClientId]);

  useEffect(() => {
    const loadTechnicians = async () => {
      setTechniciansLoading(true);
      try {
        const params = canManageAll
          ? undefined
          : resolvedClientId
            ? { clientId: resolvedClientId }
            : undefined;
        const response = await api.get("core/technicians", { params });
        const list = response?.data?.items || [];
        setTechnicians(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error("Falha ao carregar técnicos", error);
        setTechnicians([]);
      } finally {
        setTechniciansLoading(false);
      }
    };

    loadTechnicians();
  }, [canManageAll, resolvedClientId]);

  useEffect(() => {
    if (user?.role !== "admin") {
      const fallbackName = user?.attributes?.companyName || user?.name || "Meu cliente";
      setClientSelection(user?.clientId ? String(user.clientId) : "");
      setForm((prev) => ({ ...prev, clientName: prev.clientName || fallbackName }));
    }
  }, [user]);

  useEffect(() => {
    if (!canManageAll) return;
    if (clientSelection) return;
    const preferredClient = tenants?.find((client) => String(client.id) === String(tenantId)) || tenants?.[0];
    if (preferredClient?.id) {
      setClientSelection(String(preferredClient.id));
      setForm((prev) => ({ ...prev, clientName: preferredClient.name || prev.clientName }));
    }
  }, [canManageAll, clientSelection, tenantId, tenants]);

  const devicesById = useMemo(
    () => new Map(devices.map((device) => [String(device.id), device])),
    [devices],
  );
  const vehiclesById = useMemo(
    () => new Map((vehicles || []).map((vehicle) => [String(vehicle.id), vehicle])),
    [vehicles],
  );
  const equipmentOptions = useMemo(
    () =>
      devices.map((device) => ({
        id: device.id,
        label: device.name || device.uniqueId || device.id,
        model: device.model || device.modelName || device.type || device.name || null,
        status: device.status || device.connectionStatusLabel || device.attributes?.status || null,
        vehicleId: device.vehicleId || null,
        uniqueId: device.uniqueId || device.attributes?.imei || device.attributes?.serial || null,
        chipId: device.chipId || device.attributes?.chipId || null,
      })),
    [devices],
  );
  const filteredEquipmentOptions = useMemo(() => {
    const term = equipmentQuery.trim().toLowerCase();
    const selectedIds = new Set(equipments.map((item) => String(item.equipmentId)));
    const base = equipmentOptions.filter((option) => !selectedIds.has(String(option.id)));
    if (!term) return base;
    return base.filter((option) => {
      const haystack = [option.label, option.model, option.status, option.uniqueId, option.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [equipmentOptions, equipmentQuery, equipments]);

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const resolveClientName = (clientIdValue) => {
    if (!clientIdValue) return "";
    if (!canManageAll) {
      return user?.attributes?.companyName || user?.name || "Meu cliente";
    }
    return "";
  };

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!equipmentContainerRef.current) return;
      if (equipmentContainerRef.current.contains(event.target)) return;
      setEquipmentDropdownOpen(false);
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const addEquipment = (option) => {
    setEquipments((prev) => {
      const exists = prev.find((item) => String(item.equipmentId) === String(option.id));
      if (exists) {
        return prev;
      }
      return [
        ...prev,
        {
          equipmentId: option.id,
          model: option.model || option.label,
          status: option.status || null,
          vehicleId: option.vehicleId || null,
          uniqueId: option.uniqueId || null,
          chipId: option.chipId || null,
          installLocation: "",
        },
      ];
    });
  };

  const removeEquipment = (equipmentId) => {
    setEquipments((prev) => prev.filter((item) => String(item.equipmentId) !== String(equipmentId)));
  };

  const updateEquipmentLocation = (equipmentId, value) => {
    setEquipments((prev) =>
      prev.map((item) =>
        String(item.equipmentId) === String(equipmentId) ? { ...item, installLocation: value } : item,
      ),
    );
  };

  const toggleChecklistValue = (index, key, value) => {
    setChecklist((prev) => {
      const next = [...prev];
      const current = next[index]?.[key] || "";
      next[index] = { ...next[index], [key]: current === value ? "" : value };
      return next;
    });
  };

  const initSignatureCanvas = (canvas) => {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.lineWidth = 2;
    context.lineCap = "round";
    context.strokeStyle = "#ffffff";
  };

  useEffect(() => {
    initSignatureCanvas(technicianCanvasRef.current);
    initSignatureCanvas(clientCanvasRef.current);
  }, []);

  const getCanvasPosition = (canvas, event) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = event.touches?.[0]?.clientX ?? event.clientX;
    const clientY = event.touches?.[0]?.clientY ?? event.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const handleSignatureStart = (canvasRef, drawingRef, event) => {
    if (!canvasRef.current) return;
    drawingRef.current = true;
    const context = canvasRef.current.getContext("2d");
    if (!context) return;
    const { x, y } = getCanvasPosition(canvasRef.current, event);
    context.beginPath();
    context.moveTo(x, y);
  };

  const handleSignatureMove = (canvasRef, drawingRef, event) => {
    if (!drawingRef.current || !canvasRef.current) return;
    const context = canvasRef.current.getContext("2d");
    if (!context) return;
    const { x, y } = getCanvasPosition(canvasRef.current, event);
    context.lineTo(x, y);
    context.stroke();
  };

  const handleSignatureEnd = (drawingRef) => {
    drawingRef.current = false;
  };

  const handleClearSignature = (canvasRef, setter) => {
    if (!canvasRef.current) return;
    const context = canvasRef.current.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setter(null);
  };

  const handleSaveSignature = (canvasRef, setter) => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    setter(dataUrl);
  };

  const submit = async () => {
    if (!form.startAt) {
      alert("Informe a data do serviço.");
      return;
    }

    if (!clientSelection && canManageAll) {
      alert("Selecione o cliente.");
      return;
    }

    if (!technicianId) {
      alert("Selecione o técnico.");
      return;
    }

    const hasEquipmentWithoutLocation = equipments.some((item) => !item.installLocation);
    if (hasEquipmentWithoutLocation) {
      alert("Informe o local de instalação de todos os equipamentos selecionados.");
      return;
    }

    setSaving(true);
    try {
      const response = await api.post("core/service-orders", {
        clientId: canManageAll ? clientSelection || null : resolvedClientId,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        status: form.status || "SOLICITADA",
        type: form.type,
        technicianName: form.technicianName,
        clientName: form.clientName,
        responsibleName: form.responsibleName,
        responsiblePhone: form.responsiblePhone,
        addressStart: form.addressStart || null,
        address: form.address || null,
        addressReturn: form.addressReturn || null,
        km: form.km === "" ? null : Number(form.km),
        vehicleId: form.vehicleId || null,
        vehiclePlate: form.vehiclePlate || null,
        equipmentsData: equipments,
        checklistItems: checklist,
        notes: form.notes || null,
        signatures: {
          technician: technicianSignature,
          client: clientSignature,
        },
      });

      if (!response?.data?.ok) {
        throw new Error(response?.data?.error || "Falha ao criar OS");
      }

      setCreatedOrder(response.data.item || null);
    } catch (error) {
      console.error("Falha ao criar ordem de serviço", error);
      alert("Falha ao criar OS.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nova Ordem de Serviço"
        subtitle="Solicite o serviço e acompanhe o status."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {createdOrder?.id && (
              <button
                type="button"
                onClick={() => navigate(`/services/${createdOrder.id}`)}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
              >
                Ver OS criada
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
            >
              {saving ? "Salvando..." : "Criar OS"}
            </button>
          </div>
        }
      />

      {createdOrder?.osInternalId && (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <span className="font-semibold">OS:</span> {createdOrder.osInternalId}
        </div>
      )}

      <div className="space-y-8">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Dados básicos</h2>
          <div className="grid gap-3 md:grid-cols-5">
            <label className="block text-xs text-white/60">
              Data do serviço *
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(event) => setField("startAt", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                required
              />
            </label>
            <label className="block text-xs text-white/60">
              Status
              <select
                value={form.status}
                onChange={(event) => setField("status", event.target.value)}
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
              Tipo
              <select
                value={form.type}
                onChange={(event) => setField("type", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-white/60">
              Técnico
              <div className="mt-2">
                <AutocompleteSelect
                  placeholder={techniciansLoading ? "Carregando técnicos..." : "Selecione o técnico"}
                  value={technicianId}
                  options={technicians.map((tech) => ({
                    value: tech.id,
                    label: tech.name,
                    description: canManageAll
                      ? [tech.city, tech.state].filter(Boolean).join("/") || tech.contact
                      : "",
                    searchText: canManageAll
                      ? [tech.name, tech.city, tech.state, tech.contact].filter(Boolean).join(" ")
                      : tech.name,
                  }))}
                  onChange={(nextValue, option) => {
                    setTechnicianId(nextValue);
                    setField("technicianName", option?.label || "");
                  }}
                  disabled={techniciansLoading}
                />
              </div>
            </label>
            <label className="block text-xs text-white/60">
              Cliente
              <div className="mt-2">
                <AutocompleteSelect
                  placeholder="Selecione o cliente"
                  value={clientSelection}
                  options={(canManageAll
                    ? tenants
                    : clientSelection
                      ? tenants?.filter((client) => String(client.id) === String(clientSelection))
                      : []
                  ).map((client) => ({
                    value: String(client.id),
                    label: client.name,
                    searchText: client.name,
                  }))}
                  onChange={(nextValue, option) => {
                    setClientSelection(String(nextValue || ""));
                    setField("clientName", option?.label || resolveClientName(nextValue));
                  }}
                  disabled={!canManageAll}
                />
              </div>
            </label>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Responsável</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs text-white/60">
              Nome *
              <input
                value={form.responsibleName}
                onChange={(event) => setField("responsibleName", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="Nome do responsável"
                required
              />
            </label>
            <label className="block text-xs text-white/60">
              Telefone/WhatsApp
              <input
                value={form.responsiblePhone}
                onChange={(event) => setField("responsiblePhone", formatPhone(event.target.value))}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="(31) 99999-9999"
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Endereços</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <span className="block text-xs text-white/60">Endereço Partida</span>
              <div className="mt-2">
                <AddressSearchInput
                  state={addressStartState}
                  placeholder="Buscar endereço de partida"
                  variant="toolbar"
                  containerClassName="w-full"
                />
              </div>
            </div>
            <div>
              <span className="block text-xs text-white/60">Endereço Serviço</span>
              <div className="mt-2">
                <AddressSearchInput
                  state={addressServiceState}
                  placeholder="Buscar endereço do serviço"
                  variant="toolbar"
                  containerClassName="w-full"
                />
              </div>
            </div>
            <div>
              <span className="block text-xs text-white/60">Endereço Volta</span>
              <div className="mt-2">
                <AddressSearchInput
                  state={addressReturnState}
                  placeholder="Buscar endereço de retorno"
                  variant="toolbar"
                  containerClassName="w-full"
                />
              </div>
            </div>
            <label className="block text-xs text-white/60">
              KM Total
              <input
                type="number"
                value={form.km}
                onChange={(event) => setField("km", event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                placeholder="0"
                min="0"
                step="0.1"
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Veículo</h2>
          <div className="grid gap-4">
            <VehicleSelector
              label="Buscar veículo"
              placeholder="Busque por placa ou nome"
              onChange={(vehicleId, vehicle) => {
                setField("vehicleId", vehicleId || "");
                setField("vehiclePlate", vehicle?.plate || "");
                setVehicleSnapshot(vehicle || null);
                setEquipments([]);
              }}
            />

            {vehicleSnapshot ? (
              <div className="grid gap-3 rounded-xl border border-white/10 bg-black/30 p-4 text-xs text-white/70 md:grid-cols-2">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Placa</div>
                  <div className="text-sm text-white">{vehicleSnapshot.plate || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Modelo</div>
                  <div className="text-sm text-white">{vehicleSnapshot.model || vehicleSnapshot.name || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Marca</div>
                  <div className="text-sm text-white">{vehicleSnapshot.brand || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Chassi</div>
                  <div className="text-sm text-white">{vehicleSnapshot.chassis || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Renavam</div>
                  <div className="text-sm text-white">{vehicleSnapshot.renavam || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Cor</div>
                  <div className="text-sm text-white">{vehicleSnapshot.color || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Ano Modelo</div>
                  <div className="text-sm text-white">{vehicleSnapshot.modelYear || "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-white/50">Ano Fabricação</div>
                  <div className="text-sm text-white">{vehicleSnapshot.manufactureYear || "—"}</div>
                </div>
              </div>
            ) : (
              <EmptyState title="Selecione um veículo para visualizar os dados." />
            )}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Equipamentos</h2>
          <div className="space-y-3">
            {devicesLoading ? (
              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/70">
                Carregando equipamentos...
              </div>
            ) : equipmentOptions.length === 0 ? (
              <EmptyState title="Nenhum equipamento disponível para seleção." />
            ) : (
              <div className="space-y-3" ref={equipmentContainerRef}>
                <label className="block text-xs text-white/60">
                  Buscar equipamento
                  <div className="relative mt-2">
                    <input
                      value={equipmentQuery}
                      onChange={(event) => {
                        setEquipmentQuery(event.target.value);
                        setEquipmentDropdownOpen(true);
                        setEquipmentHighlightIndex(0);
                      }}
                      onFocus={() => setEquipmentDropdownOpen(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setEquipmentDropdownOpen(false);
                          return;
                        }
                        if (event.key === "Enter" && equipmentDropdownOpen) {
                          event.preventDefault();
                          const candidate =
                            filteredEquipmentOptions[equipmentHighlightIndex] || filteredEquipmentOptions[0];
                          if (candidate) {
                            addEquipment(candidate);
                            setEquipmentQuery("");
                            setEquipmentDropdownOpen(false);
                          }
                        }
                      }}
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                      placeholder="Digite ID, modelo, IMEI ou status"
                    />
                    {equipmentDropdownOpen && (
                      <div className="absolute z-[60] mt-2 max-h-60 w-full overflow-auto rounded-xl border border-white/10 bg-[#0f141c] py-1 shadow-lg">
                        {filteredEquipmentOptions.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-white/50">Nenhum equipamento encontrado.</div>
                        ) : (
                          <ul className="text-sm">
                            {filteredEquipmentOptions.map((option, index) => (
                              <li key={option.id}>
                                <button
                                  type="button"
                                  className={`flex w-full items-start justify-between px-3 py-2 text-left transition hover:bg-white/5 ${
                                    index === equipmentHighlightIndex ? "bg-white/5" : ""
                                  }`}
                                  onMouseDown={(event) => {
                                    event.preventDefault();
                                    addEquipment(option);
                                    setEquipmentQuery("");
                                    setEquipmentDropdownOpen(false);
                                  }}
                                  onMouseEnter={() => setEquipmentHighlightIndex(index)}
                                >
                                  <span className="flex flex-col">
                                    <span className="text-white">{option.label}</span>
                                    <span className="text-xs text-white/50">{option.model || "Modelo não informado"}</span>
                                  </span>
                                  <span className="text-[11px] text-white/40">{option.status || "—"}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                </label>
                {equipments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {equipments.map((equipment) => (
                      <div
                        key={equipment.equipmentId}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70"
                      >
                        <span>{equipment.model || equipment.equipmentId}</span>
                        <button
                          type="button"
                          onClick={() => removeEquipment(equipment.equipmentId)}
                          className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70 transition hover:bg-white/20"
                        >
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {equipments.length > 0 && (
              <div className="space-y-4">
                {equipments.map((equipment) => {
                  const device = devicesById.get(String(equipment.equipmentId));
                  const linkedVehicle = device?.vehicleId
                    ? vehiclesById.get(String(device.vehicleId))
                    : null;
                  return (
                    <div
                      key={equipment.equipmentId}
                      className="space-y-3 rounded-xl border border-white/10 bg-black/30 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs uppercase tracking-wide text-white/50">Equipamento selecionado</div>
                        <button
                          type="button"
                          onClick={() => removeEquipment(equipment.equipmentId)}
                          className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/70 transition hover:border-white/30"
                        >
                          Remover
                        </button>
                      </div>
                      <div className="grid gap-3 text-xs text-white/70 md:grid-cols-2">
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">ID</div>
                          <div className="text-sm text-white">{equipment.equipmentId}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Modelo</div>
                          <div className="text-sm text-white">{equipment.model || device?.model || "—"}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Status</div>
                          <div className="text-sm text-white">
                            {equipment.status || device?.status || device?.connectionStatusLabel || "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Vínculo atual</div>
                          <div className="text-sm text-white">
                            {linkedVehicle
                              ? `${linkedVehicle.plate || linkedVehicle.name || linkedVehicle.id}`
                              : device?.vehicleId
                                ? device.vehicleId
                                : "Disponível"}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-wide text-white/50">Chip/IMEI</div>
                          <div className="text-sm text-white">
                            {equipment.uniqueId || equipment.chipId || device?.uniqueId || device?.chipId || "—"}
                          </div>
                        </div>
                      </div>
                      <label className="block text-xs text-white/60">
                        Local de instalação do equipamento
                        <input
                          value={equipment.installLocation}
                          onChange={(event) => updateEquipmentLocation(equipment.equipmentId, event.target.value)}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
                          placeholder="Ex: Painel, porta, porta-luvas"
                          required
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Checklist</h2>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="min-w-full text-left text-xs text-white/70">
              <thead className="bg-white/5 text-[11px] uppercase tracking-wide text-white/60">
                <tr>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Antes</th>
                  <th className="px-3 py-2">Depois</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {checklist.map((entry, index) => (
                  <tr key={entry.item}>
                    <td className="px-3 py-2 text-white">{entry.item}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleChecklistValue(index, "before", "OK")}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ${
                            entry.before === "OK"
                              ? "border-emerald-400 bg-emerald-400/20 text-emerald-100"
                              : "border-white/10 bg-black/30 text-white/60 hover:border-white/30"
                          }`}
                          aria-label="Antes OK"
                        >
                          ✔
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleChecklistValue(index, "before", "NOK")}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ${
                            entry.before === "NOK"
                              ? "border-rose-400 bg-rose-400/20 text-rose-100"
                              : "border-white/10 bg-black/30 text-white/60 hover:border-white/30"
                          }`}
                          aria-label="Antes NOK"
                        >
                          ✖
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleChecklistValue(index, "after", "OK")}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ${
                            entry.after === "OK"
                              ? "border-emerald-400 bg-emerald-400/20 text-emerald-100"
                              : "border-white/10 bg-black/30 text-white/60 hover:border-white/30"
                          }`}
                          aria-label="Depois OK"
                        >
                          ✔
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleChecklistValue(index, "after", "NOK")}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border text-sm transition ${
                            entry.after === "NOK"
                              ? "border-rose-400 bg-rose-400/20 text-rose-100"
                              : "border-white/10 bg-black/30 text-white/60 hover:border-white/30"
                          }`}
                          aria-label="Depois NOK"
                        >
                          ✖
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Assinaturas</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wide text-white/60">Assinatura do Técnico</p>
              <canvas
                ref={technicianCanvasRef}
                width={420}
                height={180}
                className={`w-full rounded-lg border border-white/10 bg-black/40 ${
                  !canSignAsTechnician ? "opacity-60" : ""
                }`}
                onMouseDown={
                  canSignAsTechnician
                    ? (event) => handleSignatureStart(technicianCanvasRef, technicianDrawingRef, event)
                    : undefined
                }
                onMouseMove={
                  canSignAsTechnician
                    ? (event) => handleSignatureMove(technicianCanvasRef, technicianDrawingRef, event)
                    : undefined
                }
                onMouseUp={canSignAsTechnician ? () => handleSignatureEnd(technicianDrawingRef) : undefined}
                onMouseLeave={canSignAsTechnician ? () => handleSignatureEnd(technicianDrawingRef) : undefined}
                onTouchStart={
                  canSignAsTechnician
                    ? (event) => handleSignatureStart(technicianCanvasRef, technicianDrawingRef, event)
                    : undefined
                }
                onTouchMove={
                  canSignAsTechnician
                    ? (event) => handleSignatureMove(technicianCanvasRef, technicianDrawingRef, event)
                    : undefined
                }
                onTouchEnd={canSignAsTechnician ? () => handleSignatureEnd(technicianDrawingRef) : undefined}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleClearSignature(technicianCanvasRef, setTechnicianSignature)}
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 transition hover:border-white/30 disabled:opacity-60"
                  disabled={!canSignAsTechnician}
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveSignature(technicianCanvasRef, setTechnicianSignature)}
                  className="rounded-lg bg-emerald-400/80 px-3 py-1 text-xs font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
                  disabled={!canSignAsTechnician}
                >
                  Salvar
                </button>
              </div>
            </div>
            <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-xs uppercase tracking-wide text-white/60">Assinatura do Cliente</p>
              <canvas
                ref={clientCanvasRef}
                width={420}
                height={180}
                className={`w-full rounded-lg border border-white/10 bg-black/40 ${!canSignAsClient ? "opacity-60" : ""}`}
                onMouseDown={
                  canSignAsClient
                    ? (event) => handleSignatureStart(clientCanvasRef, clientDrawingRef, event)
                    : undefined
                }
                onMouseMove={
                  canSignAsClient ? (event) => handleSignatureMove(clientCanvasRef, clientDrawingRef, event) : undefined
                }
                onMouseUp={canSignAsClient ? () => handleSignatureEnd(clientDrawingRef) : undefined}
                onMouseLeave={canSignAsClient ? () => handleSignatureEnd(clientDrawingRef) : undefined}
                onTouchStart={
                  canSignAsClient
                    ? (event) => handleSignatureStart(clientCanvasRef, clientDrawingRef, event)
                    : undefined
                }
                onTouchMove={
                  canSignAsClient ? (event) => handleSignatureMove(clientCanvasRef, clientDrawingRef, event) : undefined
                }
                onTouchEnd={canSignAsClient ? () => handleSignatureEnd(clientDrawingRef) : undefined}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleClearSignature(clientCanvasRef, setClientSignature)}
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-white/70 transition hover:border-white/30 disabled:opacity-60"
                  disabled={!canSignAsClient}
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveSignature(clientCanvasRef, setClientSignature)}
                  className="rounded-lg bg-emerald-400/80 px-3 py-1 text-xs font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
                  disabled={!canSignAsClient}
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-white/10 pt-6">
          <h2 className="text-sm font-semibold text-white">Observações</h2>
          <textarea
            value={form.notes}
            onChange={(event) => setField("notes", event.target.value)}
            className="min-h-[120px] w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2 text-sm text-white focus:border-white/30 focus:outline-none"
            placeholder="Detalhes importantes para a execução."
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-xl bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/15"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-black transition hover:bg-sky-400 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Criar OS"}
        </button>
      </div>
    </div>
  );
}
