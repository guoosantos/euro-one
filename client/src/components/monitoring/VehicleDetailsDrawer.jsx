import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../lib/i18n.js";

export default function VehicleDetailsDrawer({
  vehicle,
  onClose,
  variant = "drawer",
  extraTabs = [],
  baseTabs: baseTabsOverride = null,
  floating = true,
}) {
  const { t } = useTranslation();
  const safeVehicle = vehicle || {};
  const defaultTabs = useMemo(
    () => [
      { id: "status", label: "Status" },
      { id: "info", label: "Informações" },
      { id: "trips", label: "Trajetos" },
      { id: "events", label: "Eventos" },
      { id: "cameras", label: "Câmeras" },
      { id: "commands", label: "Enviar comando" },
    ],
    [],
  );

  const tabs = useMemo(() => [...(baseTabsOverride || defaultTabs), ...extraTabs], [baseTabsOverride, defaultTabs, extraTabs]);
  const [activeTab, setActiveTab] = useState(() => tabs[0]?.id || "status");

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0]?.id || "status");
    }
  }, [activeTab, tabs]);

  const devices = Array.isArray(safeVehicle?.devices) ? safeVehicle.devices : [];
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    () =>
      safeVehicle?.principalDeviceId ||
      safeVehicle?.deviceId ||
      safeVehicle?.device?.id ||
      devices[0]?.id ||
      null,
  );

  useEffect(() => {
    setSelectedDeviceId(
      safeVehicle?.principalDeviceId ||
        safeVehicle?.deviceId ||
        safeVehicle?.device?.id ||
        devices[0]?.id ||
        null,
    );
  }, [devices, safeVehicle?.device?.id, safeVehicle?.deviceId, safeVehicle?.principalDeviceId]);

  const selectedDevice = useMemo(() => {
    if (!selectedDeviceId) return null;
    return devices.find(
      (item) =>
        String(item.id) === String(selectedDeviceId) ||
        String(item.traccarId) === String(selectedDeviceId) ||
        String(item.internalId || "") === String(selectedDeviceId),
    ) || null;
  }, [devices, selectedDeviceId]);

  const fallbackDevice = safeVehicle?.device ?? {};
  const device = selectedDevice || fallbackDevice;
  const position = device?.position || safeVehicle?.position || null;
  const lat = position?.latitude ?? position?.lat ?? safeVehicle.lat;
  const lng = position?.longitude ?? position?.lon ?? safeVehicle.lng;
  const address = safeVehicle.address || position?.address;
  const hasCameras = Array.isArray(device?.cameras) && device.cameras.length > 0;
  const latestPosition = position?.fixTime || position?.deviceTime || position?.serverTime || safeVehicle.lastUpdate;

  const statusLabel = safeVehicle.statusLabel || (latestPosition ? "Com sinal" : "Sem comunicação");
  const lastUpdateLabel = latestPosition
    ? new Date(latestPosition).toLocaleString()
    : safeVehicle.lastSeen || "Sem última posição";

  const renderContent = () => {
    if (!vehicle) {
      return (
        <Section title="Detalhes do veículo">
          <p className="text-xs text-white/60">Selecione um veículo para visualizar os detalhes.</p>
        </Section>
      );
    }

    if (activeTab === "status") {
      return (
        <>
          <Section title="Resumo">
            <Detail label="Placa" value={safeVehicle.plate} />
            <Detail
              label="ID do dispositivo"
              value={
                device?.traccarId ||
                device?.id ||
                safeVehicle.principalDeviceId ||
                safeVehicle.deviceId ||
                "—"
              }
            />
            <Detail label="Velocidade" value={`${position?.speed ?? safeVehicle.speed ?? 0} km/h`} />
            <Detail label="Última posição" value={lastUpdateLabel} />
            <Detail label="Status" value={statusLabel} />
            <Detail label="Endereço" value={formatAddress(address, lat, lng)} />
          </Section>
          <Section title="Sensores" muted>
            <p className="text-xs text-white/60">Integração com sensores (ignição, bateria, bloqueio) ficará disponível aqui.</p>
          </Section>
        </>
      );
    }

    if (activeTab === "trips") {
      return (
        <Section title="Trajetos recentes">
          <p className="text-xs text-white/60">Acesse os trajetos recentes deste veículo.</p>
          {device?.id ? (
            <Link
              to={`/trips?vehicleId=${encodeURIComponent(safeVehicle.id || "")}`}
              className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
            >
              Ver trajetos
            </Link>
          ) : (
            <p className="text-xs text-white/50">Telemetria indisponível.</p>
          )}
        </Section>
      );
    }

    if (activeTab === "events") {
      return (
        <Section title="Eventos">
          <p className="text-xs text-white/60">Eventos críticos, alertas e cercas virtuais aparecerão aqui.</p>
          <p className="text-xs text-white/40">Integração em andamento.</p>
        </Section>
      );
    }

    if (activeTab === "cameras") {
      return (
        <Section title="Câmeras / Vídeo">
          {hasCameras ? (
            <ul className="space-y-2 text-xs text-white/70">
              {device.cameras.map((camera) => (
                <li key={camera.id} className="flex items-center justify-between rounded-md border border-white/10 px-3 py-2">
                  <span>{camera.name}</span>
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.1em]">
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 hover:border-primary/70 hover:text-white"
                    >
                      Live
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 hover:border-primary/70 hover:text-white"
                    >
                      Gravações
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-white/50">Nenhuma câmera associada. TODO: integrar backend.</p>
          )}
        </Section>
      );
    }

    if (activeTab === "info") {
      return (
        <Section title="Informações do dispositivo">
          <Detail label="Modelo" value={device.model || "—"} />
          <Detail label="Identificador" value={device.uniqueId || device.identifier || "—"} />
          <Detail label="Protocolo" value={device.protocol || "—"} />
          <Detail label="Firmware" value={device.softwareVersion || "—"} />
        </Section>
      );
    }

    const customTab = tabs.find((tab) => tab.id === activeTab);
    if (customTab?.render) {
      return customTab.render({ vehicle });
    }

    return (
      <Section title="Enviar comando">
        <p className="text-xs text-white/60">Fluxo de comandos remoto ficará disponível aqui.</p>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-white/40 disabled:opacity-50"
          onClick={() => console.info("TODO: integrar fluxo de comandos")}
          disabled={!device?.id}
        >
          Enviar comando
        </button>
      </Section>
    );
  };

  const containerClass =
    variant === "page"
      ? "relative mx-auto w-full max-w-6xl border border-white/10 bg-[#0f141c]/90 shadow-2xl"
      : `${floating ? "fixed" : "relative"} inset-y-0 right-0 z-[9998] w-[420px] border-l border-white/10 bg-[#0f141c]/95 shadow-3xl backdrop-blur`;

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/50">{t("monitoring.columns.vehicle")}</p>
          <h2 className="text-lg font-semibold text-white">{safeVehicle.plate || safeVehicle.name || "Veículo"}</h2>
          <p className="text-xs text-white/60">{device?.name || device?.uniqueId || safeVehicle.name || "Fonte: veículo"}</p>
          {devices.length > 0 ? (
            <div className="mt-2">
              <label className="text-[11px] uppercase tracking-[0.12em] text-white/50">Fonte de telemetria</label>
              <select
                value={selectedDeviceId || ""}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-xs text-white focus:border-white/30 focus:outline-none"
              >
                {devices.map((item) => (
                  <option key={item.id || item.traccarId || item.uniqueId} value={item.id || item.traccarId || ""}>
                    {item.name || item.uniqueId || item.id || item.traccarId}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar detalhes"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 overflow-x-auto border-b border-white/5 px-5 py-3 text-[11px] uppercase tracking-[0.1em] text-white/60">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-md px-3 py-2 transition ${
              activeTab === tab.id ? "bg-primary/20 text-white border border-primary/40" : "border border-transparent hover:border-white/20"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4 overflow-y-auto p-5 text-sm text-white/80">{renderContent()}</div>
    </div>
  );
}

function Section({ title, children, muted = false }) {
  return (
    <section className={`rounded-xl border border-white/5 px-4 py-3 shadow-inner shadow-black/20 ${muted ? "bg-white/5" : "bg-white/10"}`}>
      <h3 className="text-[12px] uppercase tracking-[0.14em] text-white/60">{title}</h3>
      <div className="mt-2 space-y-2 text-sm text-white/80">{children}</div>
    </section>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-white/70">
      <span className="uppercase tracking-[0.12em] text-white/50">{label}</span>
      <span className="max-w-[65%] truncate text-right text-white">{value ?? "—"}</span>
    </div>
  );
}

function formatAddress(address, lat, lng) {
  if (typeof address === "string" && address.trim()) return address;
  if (address && typeof address === "object") {
    return address.formattedAddress || address.address || address.formatted || "";
  }
  if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return "—";
}
