import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer, Circle, Polygon, useMapEvents, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { useGeofences } from "../lib/hooks/useGeofences";
import { useGeofenceGroups } from "../lib/hooks/useGeofenceGroups";
import { buildGeofencePayload, decodeGeofencePolygon } from "../lib/geofence-utils";
import {
  downloadKml,
  exportGeofencesToKml,
  parseKmlPlacemarks,
} from "../lib/kml";
import useMapLifecycle from "../lib/map/useMapLifecycle.js";
import useMapController from "../lib/map/useMapController.js";
import MapZoomControls from "../components/map/MapZoomControls.jsx";
import AppMap from "../components/map/AppMap.jsx";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";

const DEFAULT_CENTER = [-23.55052, -46.633308];

function toNumber(value) {
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLatLngPoint(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const [latRaw, lngRaw] = raw;
    const lat = toNumber(latRaw);
    const lng = toNumber(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }

  if (typeof raw === "object") {
    const lat = toNumber(raw.lat ?? raw.latitude);
    const lng = toNumber(raw.lng ?? raw.lon ?? raw.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
  }
  return null;
}

function normalizePolygonPoints(points) {
  const normalized = (Array.isArray(points) ? points : []).map(normalizeLatLngPoint).filter(Boolean);
  if (normalized.length < 3) return [];
  return normalized;
}

function MapClickCapture({ onAddPoint }) {
  useMapEvents({
    click(event) {
      onAddPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export default function Fences() {
  const mapRef = useRef(null);
  const { onMapReady } = useMapLifecycle({ mapRef });
  const { registerMap, focusDevice, focusGeometry } = useMapController({ page: "Fences" });
  const userActionRef = useRef(false);
  const handleMapReady = useCallback(
    (event) => {
      onMapReady(event);
      registerMap(event?.target || event);
    },
    [onMapReady, registerMap],
  );
  const { geofences, loading, error, createGeofence, updateGeofence } = useGeofences({ autoRefreshMs: 60_000 });
  const {
    groups,
    loading: groupsLoading,
    error: groupError,
    createGroup,
    updateGroup,
    deleteGroup,
    updateGroupGeofences,
  } = useGeofenceGroups({ includeGeofences: true });

  const [layers, setLayers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [groupForm, setGroupForm] = useState({ name: "", color: "#22c55e" });
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [geometryWarning, setGeometryWarning] = useState(false);

  const groupColorMap = useMemo(() => {
    const entries = (groups || []).map((group) => [String(group.id), group.color || null]);
    return new Map(entries);
  }, [groups]);

  const buildLayersFromGeofences = useCallback(
    (source) => {
      return (Array.isArray(source) ? source : []).map((fence) => {
        const rawPoints = fence.type === "circle" ? [] : decodeGeofencePolygon(fence.area);
        const points = fence.type === "circle" ? [] : normalizePolygonPoints(rawPoints);
        const circleCenter = normalizeLatLngPoint([fence.latitude, fence.longitude]);
        const center = fence.type === "circle" ? circleCenter || DEFAULT_CENTER : points[0] || DEFAULT_CENTER;
        const geofenceGroupIds = Array.isArray(fence.geofenceGroupIds) ? fence.geofenceGroupIds.map(String) : [];
        const colorFromGroup = geofenceGroupIds.map((id) => groupColorMap.get(id)).find(Boolean);
        return {
          id: fence.id,
          name: fence.name || "Geofence",
          type: fence.type || "polygon",
          points,
          center,
          radius: fence.radius || 300,
          enabled: true,
          isTarget: Boolean(fence.isTarget ?? fence?.raw?.attributes?.isTarget ?? fence?.raw?.isTarget),
          geofenceGroupIds,
          color: fence.color || colorFromGroup || "#22c55e",
        };
      });
    },
    [groupColorMap],
  );

  useEffect(() => {
    const mapped = buildLayersFromGeofences(geofences);
    setLayers(mapped);
    setSelectedId(mapped[0]?.id || null);
  }, [buildLayersFromGeofences, geofences]);

  useEffect(() => {
    setLayers((current) =>
      current.map((layer) => {
        const colorFromGroup = (layer.geofenceGroupIds || []).map((id) => groupColorMap.get(id)).find(Boolean);
        if (colorFromGroup && colorFromGroup !== layer.color) {
          return { ...layer, color: colorFromGroup };
        }
        return layer;
      }),
    );
  }, [groupColorMap]);

  const selectedLayer = layers.find((item) => item.id === selectedId) || null;
  const selectedGroupNames = useMemo(() => {
    const map = new Map((groups || []).map((group) => [String(group.id), group.name]));
    return (selectedLayer?.geofenceGroupIds || []).map((id) => map.get(String(id))).filter(Boolean);
  }, [groups, selectedLayer?.geofenceGroupIds]);

  useEffect(() => {
    setSelectedGroupIds((current) => current.filter((id) => groups.some((group) => String(group.id) === String(id))));
  }, [groups]);

  function addLayer(type = "polygon") {
    const id = `local-${Date.now()}`;
    const layer = {
      id,
      name: `Arquivo ${layers.length + 1}`,
      type,
      points: [],
      center: DEFAULT_CENTER,
      radius: 300,
      enabled: true,
      isTarget: false,
      geofenceGroupIds: [],
      color: type === "circle" ? "#22c55e" : "#38bdf8",
    };
    setLayers((current) => [...current, layer]);
    setSelectedId(id);
  }

  function updateLayer(id, updater) {
    setLayers((current) =>
      current.map((layer) => (layer.id === id ? { ...layer, ...(typeof updater === "function" ? updater(layer) : updater) } : layer)),
    );
  }

  function deleteLayer(id) {
    setLayers((current) => current.filter((layer) => layer.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleAddPoint(point) {
    if (!selectedLayer) return;
    if (selectedLayer.type === "circle") {
      updateLayer(selectedLayer.id, { center: point });
      return;
    }
    updateLayer(selectedLayer.id, (layer) => ({ ...layer, points: [...(layer.points || []), point] }));
  }

  const resolveGeofenceId = (response, fallback) => {
    if (!response) return fallback;
    if (response.id) return response.id;
    if (response.geofence?.id) return response.geofence.id;
    return fallback;
  };

  const syncGroupAssignments = async (savedLayers) => {
    if (!Array.isArray(groups) || !groups.length) return;
    const tasks = groups.map((group) => {
      const geofenceIds = savedLayers
        .filter((layer) => (layer.geofenceGroupIds || []).some((id) => String(id) === String(group.id)))
        .map((layer) => layer.id)
        .filter((id) => id && !String(id).startsWith("local-"));
      return updateGroupGeofences(group.id, geofenceIds);
    });
    await Promise.all(tasks);
  };

  async function handleSave() {
    setSaving(true);
    try {
      const persistedLayers = [];
      for (const layer of layers) {
        const payload = buildGeofencePayload({
          name: layer.name,
          shapeType: layer.type,
          radius: layer.radius,
          center: layer.center,
          points: layer.points,
          attributes: { isTarget: Boolean(layer.isTarget) },
        });
        let result;
        if (layer.id && !String(layer.id).startsWith("local-")) {
          result = await updateGeofence(layer.id, payload);
        } else {
          result = await createGeofence(payload);
        }
        const persistedId = resolveGeofenceId(result, layer.id);
        persistedLayers.push({ ...layer, id: persistedId });
      }
      await syncGroupAssignments(persistedLayers);
      setLayers(persistedLayers);
      alert("Geofences salvas e sincronizadas com o Traccar.");
    } catch (saveError) {
      console.error(saveError);
      alert(saveError?.message || "Falha ao salvar cercas");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const placemarks = parseKmlPlacemarks(text);
    const matchGroupIds = (names = []) => {
      const normalized = names.map((name) => String(name).toLowerCase());
      return (groups || [])
        .filter((group) => normalized.includes(String(group.name || "").toLowerCase()))
        .map((group) => group.id);
    };
    const imported = placemarks
      .filter((item) => item.type === "polygon")
      .map((item, index) => ({
        id: `kml-${Date.now()}-${index}`,
        name: item.name,
        type: "polygon",
        points: normalizePolygonPoints(item.points),
        center: normalizeLatLngPoint(item.points?.[0]) || DEFAULT_CENTER,
        radius: 300,
        enabled: true,
        geofenceGroupIds: matchGroupIds(item.geofenceGroupNames),
        color: "#f97316",
      }));
    setLayers((current) => [...current, ...imported]);
    if (imported[0]) setSelectedId(imported[0].id);
  }

  function handleExport() {
    const groupMap = new Map((groups || []).map((group) => [String(group.id), group.name]));
    const payload = enabledShapes.map((layer) => ({
      ...layer,
      geofenceGroupNames: (layer.geofenceGroupIds || []).map((id) => groupMap.get(String(id))).filter(Boolean),
    }));
    const kml = exportGeofencesToKml(payload);
    downloadKml("geofences.kml", kml);
  }

  const isFiltering = selectedGroupIds.length > 0;
  const visibleLayers = useMemo(() => {
    if (!isFiltering) return layers;
    return layers.filter((layer) => (layer.geofenceGroupIds || []).some((id) => selectedGroupIds.includes(id)));
  }, [isFiltering, layers, selectedGroupIds]);

  useEffect(() => {
    if (selectedId && visibleLayers.length && !visibleLayers.some((layer) => layer.id === selectedId)) {
      setSelectedId(visibleLayers[0].id);
    }
  }, [visibleLayers, selectedId]);

  const mapShapes = useMemo(() => visibleLayers, [visibleLayers]);
  const enabledShapes = useMemo(() => visibleLayers.filter((layer) => layer.enabled), [visibleLayers]);

  const handleGroupFormSubmit = async (event) => {
    event.preventDefault();
    if (!groupForm.name?.trim()) return;
    try {
      if (editingGroupId) {
        await updateGroup(editingGroupId, groupForm);
      } else {
        await createGroup(groupForm);
      }
      setGroupForm({ name: "", color: "#22c55e" });
      setEditingGroupId(null);
    } catch (err) {
      console.error("Erro ao salvar grupo de cercas", err);
      alert("Falha ao salvar grupo de cercas");
    }
  };

  const handleDeleteGroup = async (id) => {
    if (!window.confirm("Deseja remover este grupo?")) return;
    try {
      await deleteGroup(id);
    } catch (err) {
      console.error("Erro ao remover grupo", err);
      alert("Falha ao remover grupo");
    }
  };

  const toggleLayerGroup = (layerId, groupId, enabled) => {
    updateLayer(layerId, (layer) => {
      const next = new Set(layer.geofenceGroupIds || []);
      if (enabled) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return { geofenceGroupIds: Array.from(next) };
    });
  };

  const toggleGroupFilter = (groupId) => {
    setSelectedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return Array.from(next);
    });
  };


  const { drawableShapes, invalidCount } = useMemo(() => {
    let invalid = 0;
    const shapes = [];

    enabledShapes.forEach((layer) => {
      if (layer.type === "circle") {
        const center = normalizeLatLngPoint(layer.center);
        const radius = Number(layer.radius);
        if (!center || !Number.isFinite(radius) || radius <= 0) {
          invalid += 1;
          return;
        }
        shapes.push({ ...layer, center, radius });
        return;
      }

      const polygonPoints = normalizePolygonPoints(layer.points);
      if (polygonPoints.length < 3) {
        invalid += 1;
        return;
      }
      shapes.push({ ...layer, points: polygonPoints });
    });

    return { drawableShapes: shapes, invalidCount: invalid };
  }, [enabledShapes]);

  useEffect(() => {
    setGeometryWarning(invalidCount > 0);
  }, [invalidCount]);

  const handleCancel = () => {
    const mapped = buildLayersFromGeofences(geofences);
    setLayers(mapped);
    setSelectedId(mapped[0]?.id || null);
  };

  const handleSelectLayer = useCallback((id) => {
    userActionRef.current = true;
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!userActionRef.current) return;
    if (!selectedLayer) return;
    if (selectedLayer.type === "circle") {
      const center = normalizeLatLngPoint(selectedLayer.center);
      if (center) {
        focusDevice({ lat: center[0], lng: center[1] }, { zoom: 15, reason: "GEOFENCE_SELECT" });
      }
    } else {
      const points = normalizePolygonPoints(selectedLayer.points);
      if (points.length) {
        focusGeometry(points, { padding: [24, 24], maxZoom: 16 }, "GEOFENCE_SELECT");
      }
    }
    userActionRef.current = false;
  }, [focusDevice, focusGeometry, selectedLayer]);

  return (
    <div className="relative -mx-6 -mt-4 h-[calc(100vh-96px)] min-w-0 overflow-hidden bg-neutral-900">
      <AppMap
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={12}
        className="absolute inset-0 z-0 h-full w-full"
        preferCanvas
        attributionControl={false}
        zoomControl={false}
        whenReady={handleMapReady}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapZoomControls variant="classic" />
        <MapClickCapture onAddPoint={handleAddPoint} />
        {drawableShapes.map((layer) => {
          if (layer.type === "circle") {
            return (
              <Circle key={layer.id} center={layer.center} radius={layer.radius} pathOptions={{ color: layer.color }}>
                <Popup>
                  <strong>{layer.name}</strong>
                </Popup>
              </Circle>
            );
          }

          return (
            <Polygon key={layer.id} positions={layer.points} pathOptions={{ color: layer.color }}>
              <Popup>
                <strong>{layer.name}</strong>
              </Popup>
            </Polygon>
          );
        })}
      </AppMap>

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-3">
        {geometryWarning && (
          <div className="pointer-events-auto ml-auto mr-4 mt-4 w-full max-w-sm rounded-lg border border-amber-500/40 bg-amber-900/90 p-3 text-sm text-amber-100 shadow-lg">
            Geofence inválida — verifique coordenadas
          </div>
        )}

        {error && (
          <div className="pointer-events-auto mx-4 rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-100">
            {error.message}
          </div>
        )}
        {groupError && (
          <div className="pointer-events-auto mx-4 rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-100">
            {groupError.message}
          </div>
        )}

        <div className="pointer-events-auto flex flex-wrap gap-2 px-4">
          <Button onClick={() => addLayer("polygon")} variant="secondary">
            Polígono
          </Button>
          <Button onClick={() => addLayer("circle")}>Círculo</Button>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-neutral-900/70 px-3 py-2 text-sm text-white shadow">
            Importar KML
            <input type="file" accept=".kml" className="hidden" onChange={handleImport} />
          </label>
          <Button variant="secondary" onClick={handleExport}>
            Exportar KML
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="ghost" onClick={handleCancel}>
            Cancelar
          </Button>
        </div>

        <div className="pointer-events-auto flex-1 overflow-y-auto px-4 pb-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/80 p-4 shadow-xl backdrop-blur lg:col-span-1">
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white/80">Grupos de cercas</h3>
                    <p className="text-xs text-white/60">Crie, edite e filtre o mapa por grupos.</p>
                  </div>
                  {groupsLoading && <span className="text-[10px] uppercase tracking-wide text-white/50">Carregando…</span>}
                </div>

                <form onSubmit={handleGroupFormSubmit} className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
                  <Input
                    label={editingGroupId ? "Editar grupo" : "Novo grupo"}
                    placeholder="Nome do grupo"
                    value={groupForm.name}
                    onChange={(event) => setGroupForm((current) => ({ ...current, name: event.target.value }))}
                  />
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-white/70">Cor</label>
                    <input
                      type="color"
                      value={groupForm.color}
                      onChange={(event) => setGroupForm((current) => ({ ...current, color: event.target.value }))}
                    />
                    <div className="flex-1" />
                    {editingGroupId && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setEditingGroupId(null);
                          setGroupForm({ name: "", color: "#22c55e" });
                        }}
                      >
                        Cancelar
                      </Button>
                    )}
                    <Button type="submit">{editingGroupId ? "Atualizar" : "Adicionar"}</Button>
                  </div>
                </form>

                <div className="space-y-2">
                  {groups.length === 0 && <p className="text-sm text-white/60">Nenhum grupo cadastrado ainda.</p>}
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.includes(group.id)}
                        onChange={() => toggleGroupFilter(group.id)}
                      />
                      <span className="h-3 w-3 rounded" style={{ backgroundColor: group.color || "#22c55e" }} />
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-white">{group.name}</div>
                        <div className="text-xs text-white/60">{group.description || ""}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="secondary" onClick={() => toggleGroupFilter(group.id)}>
                          {selectedGroupIds.includes(group.id) ? "Filtrando" : "Filtrar"}
                        </Button>
                        <Button
                          size="xs"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setGroupForm({ name: group.name, color: group.color || "#22c55e" });
                          }}
                        >
                          Editar
                        </Button>
                        <Button size="xs" variant="danger" onClick={() => handleDeleteGroup(group.id)}>
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {isFiltering && (
                  <div className="text-xs text-white/60">Mostrando apenas grupos selecionados ({selectedGroupIds.length}).</div>
                )}
              </div>

              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                <h3 className="text-sm font-semibold text-white/80">Layers</h3>
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
                  {mapShapes.length === 0 && <p className="text-sm text-white/60">Nenhuma cerca carregada ainda.</p>}
                  {mapShapes.map((layer) => (
                    <div
                      key={layer.id}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                        selectedId === layer.id ? "border-primary/60 bg-primary/10" : "border-white/10"
                      }`}
                    >
                      <div>
                        <button
                          type="button"
                          onClick={() => handleSelectLayer(layer.id)}
                          className="text-left text-sm font-semibold text-white"
                        >
                          {layer.name}
                        </button>
                        <div className="text-xs text-white/60">{layer.type === "circle" ? "Círculo" : "Polígono"}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={layer.color}
                          onChange={(event) => updateLayer(layer.id, { color: event.target.value })}
                          aria-label="Cor"
                        />
                        <input
                          type="checkbox"
                          checked={layer.enabled}
                          onChange={(event) => updateLayer(layer.id, { enabled: event.target.checked })}
                          aria-label="Habilitar"
                        />
                        <button
                          type="button"
                          className="rounded bg-white/10 px-2 py-1 text-xs"
                          onClick={() => deleteLayer(layer.id)}
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-white/10 bg-neutral-900/80 p-4 shadow-xl backdrop-blur lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-white">Cerca Virtual (KML-first)</h2>
                  <p className="text-xs text-white/70">Selecione uma camada e desenhe diretamente sobre o mapa.</p>
                </div>
                <span className="text-xs text-white/60">{loading ? "Carregando cercas…" : `${layers.length} layers`}</span>
              </div>

              {selectedLayer && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <Input
                    label="Nome"
                    value={selectedLayer.name}
                    onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })}
                  />
                  <Select
                    value={selectedLayer.type}
                    onChange={(event) => updateLayer(selectedLayer.id, { type: event.target.value })}
                  >
                    <option value="polygon">Polígono</option>
                    <option value="circle">Círculo</option>
                  </Select>
                  <label className="flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedLayer.isTarget)}
                      onChange={(event) => updateLayer(selectedLayer.id, { isTarget: event.target.checked })}
                      className="rounded border-white/30 bg-transparent"
                    />
                    Marcar como Alvo
                  </label>
                  {selectedLayer.type === "circle" && (
                    <Input
                      label="Raio (m)"
                      type="number"
                      value={selectedLayer.radius}
                      onChange={(event) => updateLayer(selectedLayer.id, { radius: Number(event.target.value) })}
                    />
                  )}
                  {selectedLayer.type === "polygon" && (
                    <p className="text-sm text-white/60">Clique no mapa para adicionar vértices ao polígono.</p>
                  )}
                  <p className="text-xs text-white/50">Pontos atuais: {selectedLayer.points?.length || 0}</p>
                  <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs font-semibold text-white/70">Grupos associados</div>
                    <div className="flex flex-wrap gap-2">
                      {groups.length === 0 && <span className="text-xs text-white/50">Nenhum grupo cadastrado.</span>}
                      {groups.map((group) => (
                        <label key={group.id} className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-xs">
                          <input
                            type="checkbox"
                            checked={selectedLayer.geofenceGroupIds?.includes(group.id)}
                            onChange={(event) => toggleLayerGroup(selectedLayer.id, group.id, event.target.checked)}
                          />
                          <span className="h-3 w-3 rounded" style={{ backgroundColor: group.color || "#22c55e" }} />
                          <span>{group.name}</span>
                        </label>
                      ))}
                    </div>
                    {selectedGroupNames.length > 0 && (
                      <div className="text-[11px] text-white/50">
                        Grupos selecionados: {selectedGroupNames.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!selectedLayer && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  Nenhuma layer selecionada. Clique em um item para editar ou desenhe uma nova camada.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
