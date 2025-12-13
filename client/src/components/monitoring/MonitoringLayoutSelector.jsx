import React from "react";

export default function MonitoringLayoutSelector({
  layoutVisibility,
  onToggle,
  onClose,
  searchRadius,
  onRadiusChange,
  mapLayers = [],
  activeMapLayer,
  onMapLayerChange,
}) {
  const options = [
    { key: "showMap", label: "Mostrar Mapa" },
    { key: "showTable", label: "Mostrar Tabela" },
  ];

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0f141c] p-6 text-sm text-white/80 shadow-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Layout da tela</div>
            <p className="text-xs text-white/60">Ative ou desative áreas e personalize o raio de busca.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 text-white/70 transition hover:border-white/30 hover:text-white"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {options.map((option) => {
            const isChecked = layoutVisibility?.[option.key] !== false;

            return (
              <label
                key={option.key}
                className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 hover:border-white/30 cursor-pointer select-none transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isChecked ? "bg-primary border-primary" : "border-white/30 bg-transparent"}`}
                  >
                    {isChecked && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  <span className={`text-sm ${isChecked ? "text-white" : "text-white/60"}`}>{option.label}</span>
                </div>

                <input
                  type="checkbox"
                  className="hidden"
                  checked={isChecked}
                  onChange={() => onToggle && onToggle(option.key)}
                />
              </label>
            );
          })}

          <div className="rounded-lg border border-white/10 px-3 py-2">
            <label className="flex flex-col gap-1 text-xs text-white/60" htmlFor="search-radius">
              Raio de busca (m)
            </label>
            <input
              id="search-radius"
              type="number"
              min={50}
              max={5000}
              value={searchRadius}
              onChange={(event) => onRadiusChange?.(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/60 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-white/50">Ajuste o raio usado na busca por endereço (50m a 5km).</p>
          </div>

          {mapLayers.length > 0 && (
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <div className="text-sm font-semibold text-white">Tipo de mapa</div>
              <p className="text-[11px] text-white/60">Escolha o provedor exibido no mapa.</p>

              <div className="mt-2 space-y-2">
                {mapLayers.map((layer) => {
                  const isActive = layer.key === activeMapLayer;
                  return (
                    <label
                      key={layer.key}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition ${isActive ? "border-primary/60 bg-primary/10 text-white" : "border-white/10 text-white/70 hover:border-white/30"}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-semibold">{layer.label}</span>
                        {layer.description ? (
                          <span className="text-[11px] text-white/60">{layer.description}</span>
                        ) : null}
                      </div>
                      <input
                        type="radio"
                        name="map-layer"
                        className="h-4 w-4"
                        checked={isActive}
                        onChange={() => onMapLayerChange?.(layer.key)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
