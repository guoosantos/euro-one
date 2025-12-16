import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Circle, Polygon, useMapEvents, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { useGeofences } from "../lib/hooks/useGeofences";
import { buildGeofencePayload, decodeGeofencePolygon } from "../lib/geofence-utils";
import {
  downloadKml,
  exportGeofencesToKml,
  parseKmlPlacemarks,
} from "../lib/kml";
import Button from "../ui/Button";
import Input from "../ui/Input";

const DEFAULT_CENTER = [-23.55052, -46.633308];

function MapClickCapture({ onAddPoint }) {
  useMapEvents({
    click(event) {
      onAddPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export default function Fences() {
  const { geofences, loading, error, createGeofence, updateGeofence } = useGeofences({ autoRefreshMs: 60_000 });

  const [layers, setLayers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const mapped = (Array.isArray(geofences) ? geofences : []).map((fence) => {
      const points = fence.type === "circle" ? [] : decodeGeofencePolygon(fence.area);
      const center = fence.type === "circle" ? [fence.latitude, fence.longitude] : points[0] || DEFAULT_CENTER;
      return {
        id: fence.id,
        name: fence.name || "Geofence",
        type: fence.type || "polygon",
        points: points || [],
        center,
        radius: fence.radius || 300,
        enabled: true,
        color: fence.color || "#22c55e",
      };
    });
    setLayers(mapped);
    setSelectedId(mapped[0]?.id || null);
  }, [geofences]);

  const selectedLayer = layers.find((item) => item.id === selectedId) || null;

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

  async function handleSave() {
    setSaving(true);
    try {
      for (const layer of layers) {
        const payload = buildGeofencePayload({
          name: layer.name,
          shapeType: layer.type,
          radius: layer.radius,
          center: layer.center,
          points: layer.points,
        });
        if (layer.id && !String(layer.id).startsWith("local-")) {
          await updateGeofence(layer.id, payload);
        } else {
          await createGeofence(payload);
        }
      }
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
    const imported = placemarks
      .filter((item) => item.type === "polygon")
      .map((item, index) => ({
        id: `kml-${Date.now()}-${index}`,
        name: item.name,
        type: "polygon",
        points: item.points,
        center: item.points[0] || DEFAULT_CENTER,
        radius: 300,
        enabled: true,
        color: "#f97316",
      }));
    setLayers((current) => [...current, ...imported]);
    if (imported[0]) setSelectedId(imported[0].id);
  }

  function handleExport() {
    const kml = exportGeofencesToKml(layers.filter((layer) => layer.enabled));
    downloadKml("geofences.kml", kml);
  }

  const mapShapes = useMemo(() => layers, [layers]);
  const enabledShapes = useMemo(() => layers.filter((layer) => layer.enabled), [layers]);

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Cerca Virtual (KML-first)</h2>
            <p className="text-xs opacity-70">Gerencie arquivos/layers acima e desenhe no mapa abaixo.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => addLayer("polygon")}>Criar geofence</Button>
            <Button onClick={() => addLayer("circle")}>Criar círculo</Button>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-white">
              Importar KML
              <input type="file" accept=".kml" className="hidden" onChange={handleImport} />
            </label>
            <Button variant="secondary" onClick={handleExport}>
              Exportar KML
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-1">
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
                      onClick={() => setSelectedId(layer.id)}
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

            {selectedLayer && (
              <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
                <Input
                  label="Nome"
                  value={selectedLayer.name}
                  onChange={(event) => updateLayer(selectedLayer.id, { name: event.target.value })}
                />
                {selectedLayer.type === "circle" && (
                  <Input
                    label="Raio (m)"
                    type="number"
                    value={selectedLayer.radius}
                    onChange={(event) => updateLayer(selectedLayer.id, { radius: Number(event.target.value) })}
                  />
                )}
                {selectedLayer.type === "polygon" && (
                  <p className="text-sm text-white/60">Clique no mapa abaixo para adicionar vértices ao polígono.</p>
                )}
                <p className="text-xs text-white/50">Pontos atuais: {selectedLayer.points?.length || 0}</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <MapContainer center={selectedLayer?.center || DEFAULT_CENTER} zoom={13} style={{ height: 480 }} className="bg-layer">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickCapture onAddPoint={handleAddPoint} />
                {enabledShapes.map((layer) =>
                  layer.type === "circle" ? (
                    <Circle key={layer.id} center={layer.center} radius={layer.radius} pathOptions={{ color: layer.color }}>
                      <Popup>
                        <strong>{layer.name}</strong>
                      </Popup>
                    </Circle>
                  ) : (
                    <Polygon key={layer.id} positions={layer.points} pathOptions={{ color: layer.color }}>
                      <Popup>
                        <strong>{layer.name}</strong>
                      </Popup>
                    </Polygon>
                  ),
                )}
              </MapContainer>
            </div>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}

      <section className="card space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Geofences ativas</h3>
            <p className="text-xs opacity-70">Sincronizadas a cada minuto do Traccar.</p>
          </div>
          <span className="text-xs opacity-60">{loading ? "Carregando cercas…" : `${layers.length} layers`}</span>
        </header>
      </section>
    </div>
  );
}
