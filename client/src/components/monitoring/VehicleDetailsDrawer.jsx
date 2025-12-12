import React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../lib/i18n.js";

export default function VehicleDetailsDrawer({ vehicle, onClose }) {
  const { t } = useTranslation();

  if (!vehicle) return null;

  const { device, position } = vehicle;
  const address = vehicle.address || position?.address;
  const hasCameras = Array.isArray(device?.cameras) && device.cameras.length > 0;

  return (
    <div className="fixed inset-y-0 right-0 z-[9998] w-full max-w-xl border-l border-white/10 bg-[#0f141c]/95 shadow-3xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-white/50">{t("monitoring.columns.vehicle")}</p>
          <h2 className="text-lg font-semibold text-white">{vehicle.deviceName}</h2>
          <p className="text-xs text-white/60">{vehicle.plate}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-10 w-10 rounded-full border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
          aria-label="Fechar detalhes"
        >
          ✕
        </button>
      </div>

      <div className="space-y-4 overflow-y-auto p-5 text-sm text-white/80">
        <Section title="Resumo">
          <Detail label="Placa" value={vehicle.plate} />
          <Detail label="ID do dispositivo" value={vehicle.deviceId} />
          <Detail label="Velocidade" value={`${vehicle.speed ?? 0} km/h`} />
          <Detail label="Última posição" value={vehicle.lastUpdate ? vehicle.lastUpdate.toLocaleString() : "—"} />
          <Detail label="Endereço" value={formatAddress(address, vehicle.lat, vehicle.lng)} />
        </Section>

        <Section title="Trajetos">
          <p className="text-xs text-white/60">Acesse os trajetos recentes deste veículo.</p>
          <Link
            to={`/trips?deviceId=${encodeURIComponent(vehicle.deviceId)}`}
            className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-primary/80"
          >
            Ver trajetos
          </Link>
        </Section>

        <Section title="Comandos">
          <p className="text-xs text-white/60">Envie comandos para o dispositivo selecionado.</p>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-white/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white transition hover:border-white/40"
            onClick={() => console.info("TODO: integrar fluxo de comandos")}
          >
            Enviar comando
          </button>
        </Section>

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
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 shadow-inner shadow-black/20">
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
