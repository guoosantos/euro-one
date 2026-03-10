import React, { useEffect, useState } from "react";

export default function MonitoringLayoutSelector({
  layoutVisibility,
  onSave,
  onClose,
  searchRadius,
  mapLayers = [],
  mapLayerSections = [],
  activeMapLayer,
  sortingEnabled = true,
  sortKey = null,
  sortDirection = null,
  sortOptions = [],
}) {
  const [workingVisibility, setWorkingVisibility] = useState({ ...(layoutVisibility || {}) });
  const [workingRadius, setWorkingRadius] = useState(searchRadius || 0);
  const [workingMapLayer, setWorkingMapLayer] = useState(activeMapLayer);
  const [workingSortingEnabled, setWorkingSortingEnabled] = useState(Boolean(sortingEnabled));
  const [workingSortKey, setWorkingSortKey] = useState(sortKey);
  const [workingSortDir, setWorkingSortDir] = useState(sortDirection);
  const sortingAvailable = workingVisibility?.showExcelFilters !== false;

  useEffect(() => {
    setWorkingVisibility({ ...(layoutVisibility || {}) });
  }, [layoutVisibility]);

  useEffect(() => {
    setWorkingRadius(searchRadius || 0);
  }, [searchRadius]);

  useEffect(() => {
    setWorkingMapLayer(activeMapLayer);
  }, [activeMapLayer]);

  useEffect(() => {
    setWorkingSortingEnabled(Boolean(sortingEnabled));
  }, [sortingEnabled]);

  useEffect(() => {
    setWorkingSortKey(sortKey ?? null);
  }, [sortKey]);

  useEffect(() => {
    setWorkingSortDir(sortDirection);
  }, [sortDirection]);

  useEffect(() => {
    if (!sortingAvailable) {
      setWorkingSortingEnabled(false);
      setWorkingSortKey(null);
      setWorkingSortDir(null);
    }
  }, [sortingAvailable]);

  useEffect(() => {
    if (!workingSortingEnabled) {
      setWorkingSortKey(null);
      setWorkingSortDir(null);
    }
  }, [workingSortingEnabled]);

  const options = [
    { key: "showMap", label: "Mostrar Mapa" },
    { key: "showTable", label: "Mostrar Tabela" },
    { key: "showToolbar", label: "Ativar busca e filtros rápidos" },
    { key: "showTopbar", label: "Mostrar Top bar fixa" },
    { key: "showExcelFilters", label: "Filtros por coluna (Excel)" },
  ];

  const sections = mapLayerSections?.length
    ? mapLayerSections
    : [{ key: "default", label: "Mapas", layers: mapLayers }];

  const handleToggle = (key) => {
    setWorkingVisibility((prev) => {
      const next = { ...(prev || {}), [key]: !prev?.[key] };
      if (key === "showMap" || key === "showTable") {
        if (!next.showMap && !next.showTable) {
          next[key] = true;
        }
      }
      return next;
    });
  };

  const handleSave = () => {
    const canUseSorting = sortingAvailable && workingSortingEnabled;
    onSave?.({
      visibility: workingVisibility,
      searchRadius: workingRadius,
      mapLayerKey: workingMapLayer,
      sortingEnabled: canUseSorting,
      sortKey: canUseSorting ? workingSortKey : null,
      sortDir: canUseSorting ? workingSortDir : null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0f141c] p-6 text-sm text-white/80 shadow-3xl"
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
            const isChecked = workingVisibility?.[option.key] !== false;

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
                  onChange={() => handleToggle(option.key)}
                />
              </label>
            );
          })}

          <div className={`rounded-lg border px-3 py-2 ${sortingAvailable ? "border-white/10" : "border-white/5 opacity-70"}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Filtro por Ordenação</div>
                <p className="text-[11px] text-white/60">
                  {sortingAvailable
                    ? "Marque para exibir os controles de ordenação da tabela."
                    : 'Ative "Filtros por coluna (Excel)" para habilitar esta opção.'}
                </p>
              </div>
              <input
                type="checkbox"
                className="h-4 w-4"
                disabled={!sortingAvailable}
                checked={sortingAvailable && workingSortingEnabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setWorkingSortingEnabled(checked);
                  if (!checked) {
                    setWorkingSortKey(null);
                    setWorkingSortDir(null);
                  } else if (!workingSortDir) {
                    setWorkingSortDir("asc");
                  }
                }}
              />
            </div>
          </div>

          {sortingAvailable && workingSortingEnabled && (
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <div className="text-sm font-semibold text-white">Ordenação da tabela</div>
              <p className="text-[11px] text-white/60">Defina a coluna e a direção da ordenação.</p>

              <label className="mt-2 flex flex-col gap-1 text-xs text-white/60" htmlFor="monitoring-sort-key">
                Ordenar por
              </label>
              <select
                id="monitoring-sort-key"
                value={workingSortKey || ""}
                onChange={(event) => {
                  const nextKey = event.target.value || null;
                  setWorkingSortKey(nextKey);
                  if (nextKey && !workingSortDir) {
                    setWorkingSortDir("asc");
                  }
                }}
                className={`mt-1 w-full rounded-md border px-3 py-2 text-sm text-white focus:outline-none ${
                  workingSortKey
                    ? "border-primary/70 bg-[#112746] shadow-[inset_0_-2px_0_0_rgba(59,130,246,0.92)] focus:border-primary"
                    : "border-white/10 bg-white/5 focus:border-primary/60"
                }`}
              >
                <option value="">Selecione uma coluna</option>
                {sortOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!workingSortKey}
                    onClick={() => setWorkingSortDir("asc")}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                      workingSortDir === "asc"
                        ? "border-primary bg-[#1f3f66] text-white shadow-[inset_0_-2px_0_0_rgba(147,197,253,0.95)]"
                        : "border-white/10 bg-[#111827]/75 text-white/70 hover:border-primary/55 hover:bg-[#163152] hover:text-white"
                    }`}
                  >
                    Ascendente
                  </button>
                  <button
                    type="button"
                    disabled={!workingSortKey}
                    onClick={() => setWorkingSortDir("desc")}
                    className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                      workingSortDir === "desc"
                        ? "border-primary bg-[#1f3f66] text-white shadow-[inset_0_-2px_0_0_rgba(147,197,253,0.95)]"
                        : "border-white/10 bg-[#111827]/75 text-white/70 hover:border-primary/55 hover:bg-[#163152] hover:text-white"
                    }`}
                  >
                    Descendente
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setWorkingSortKey(null);
                    setWorkingSortDir(null);
                  }}
                  className="rounded-md border border-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/70 hover:border-white/30 hover:text-white"
                >
                  Limpar ordenação
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/10 px-3 py-2">
            <label className="flex flex-col gap-1 text-xs text-white/60" htmlFor="search-radius">
              Raio de busca (m)
            </label>
            <input
              id="search-radius"
              type="number"
              min={50}
              max={5000}
              step={50}
              value={workingRadius}
              onChange={(event) => setWorkingRadius(Number(event.target.value))}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-primary/60 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-white/50">Ajuste o raio usado na busca por endereço (50m a 5km).</p>
          </div>

          {sections.some((section) => section.layers?.length) && (
            <div className="rounded-lg border border-white/10 px-3 py-2">
              <div className="text-sm font-semibold text-white">Tipo de mapa</div>
              <p className="text-[11px] text-white/60">Escolha o provedor exibido no mapa.</p>

              <div className="mt-2 max-h-[70vh] space-y-3 overflow-y-auto pr-1">
                {sections.map((section) => {
                  if (!section.layers?.length) return null;
                  const sectionHasEnabled = section.layers.some((layer) => layer.available !== false && layer.url);
                  return (
                    <div key={section.key} className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-white/50">
                        <span className="font-semibold text-white/80">{section.label}</span>
                        {!sectionHasEnabled && section.disabledMessage && (
                          <span className="text-[10px] text-amber-300/80" title={section.disabledMessage}>
                            {section.disabledMessage}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        {section.layers.map((layer) => {
                          const isActive = layer.key === workingMapLayer;
                          const isDisabled = layer.available === false || !layer.url;
                          return (
                            <label
                              key={layer.key}
                              title={isDisabled ? section.disabledMessage || "Mapa não configurado" : undefined}
                              className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition ${isDisabled
                                ? "border-white/5 text-white/40"
                                : isActive
                                  ? "border-primary/60 bg-primary/10 text-white"
                                  : "border-white/10 text-white/70 hover:border-white/30"}`}
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
                                disabled={isDisabled}
                                checked={isActive}
                                onChange={() => setWorkingMapLayer(layer.key)}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-white/10 px-3 py-2 text-[11px] font-semibold text-white/80 hover:border-white/30"
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-md border border-primary/40 bg-primary/20 px-3 py-2 text-[11px] font-semibold text-white hover:border-primary/60"
            onClick={handleSave}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
