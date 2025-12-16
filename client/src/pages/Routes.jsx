import React, { useEffect, useMemo, useState } from "react";
import { MapContainer, Polyline, TileLayer, useMapEvents, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

import useDevices from "../lib/hooks/useDevices";
import Button from "../ui/Button";
import Input from "../ui/Input";
import Select from "../ui/Select";
import { API_ROUTES } from "../lib/api-routes.js";
import api from "../lib/api.js";
import { deduplicatePath, downloadKml, exportRoutesToKml, parseKmlPlacemarks, simplifyPath } from "../lib/kml";

const DEFAULT_CENTER = [-23.55052, -46.633308];
const STORAGE_KEY = "euro-one-routes";

function MapRouteCreator({ active, onAddPoint }) {
  useMapEvents({
    click(event) {
      if (!active) return;
      onAddPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  return null;
}

export default function RoutesPage() {
  const { devices } = useDevices();
  const deviceOptions = useMemo(
    () =>
      (Array.isArray(devices) ? devices : []).map((device) => ({
        value: device.traccarId || device.deviceId || device.id || device.uniqueId,
        label: device.name || device.uniqueId || device.id,
      })),
    [devices],
  );

  const [routes, setRoutes] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch (_error) {
      return [];
    }
  });
  const [selectedId, setSelectedId] = useState(null);
  const [historyForm, setHistoryForm] = useState({ deviceId: "", from: "", to: "" });
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!selectedId && routes[0]) setSelectedId(routes[0].id);
  }, [routes, selectedId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
    } catch (_error) {
      // ignore
    }
  }, [routes]);

  const selectedRoute = routes.find((route) => route.id === selectedId) || null;

  function addRoute() {
    const id = `route-${Date.now()}`;
    const route = {
      id,
      name: `Rota ${routes.length + 1}`,
      points: [],
      color: "#38bdf8",
    };
    setRoutes((current) => [...current, route]);
    setSelectedId(id);
  }

  function updateRoute(id, updater) {
    setRoutes((current) =>
      current.map((route) => (route.id === id ? { ...route, ...(typeof updater === "function" ? updater(route) : updater) } : route)),
    );
  }

  function deleteRoute(id) {
    setRoutes((current) => current.filter((route) => route.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function handleAddPoint(point) {
    if (!selectedRoute) return;
    updateRoute(selectedRoute.id, (route) => ({ ...route, points: [...(route.points || []), point] }));
  }

  function persistRoutes(nextRoutes) {
    setRoutes(nextRoutes);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextRoutes));
  }

  async function fetchHistoryRoute(event) {
    event.preventDefault();
    if (!historyForm.deviceId || !historyForm.from || !historyForm.to || !selectedRoute) return;
    setLoadingHistory(true);
    try {
      const params = {
        deviceId: historyForm.deviceId,
        from: new Date(historyForm.from).toISOString(),
        to: new Date(historyForm.to).toISOString(),
      };
      const response = await api.get(API_ROUTES.reports.route, { params });
      const data = response?.data?.data || response?.data || {};
      const positions = Array.isArray(data.positions) ? data.positions : data;
      const rawPoints = (positions || [])
        .map((pos) => [Number(pos.latitude ?? pos.lat), Number(pos.longitude ?? pos.lon)])
        .filter((pair) => pair.every((value) => Number.isFinite(value)));
      const simplified = simplifyPath(deduplicatePath(rawPoints), 0.00005);
      updateRoute(selectedRoute.id, { points: simplified, name: `${selectedRoute.name} · histórico` });
    } catch (routeError) {
      console.error(routeError);
      alert(routeError?.message || "Não foi possível gerar rota");
    } finally {
      setLoadingHistory(false);
    }
  }

  function handleImportKml(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const placemarks = parseKmlPlacemarks(text).filter((item) => item.type === "polyline");
      const imported = placemarks.map((item, index) => ({
        id: `kml-route-${Date.now()}-${index}`,
        name: item.name,
        points: item.points,
        color: "#f97316",
      }));
      const next = [...routes, ...imported];
      persistRoutes(next);
      if (imported[0]) setSelectedId(imported[0].id);
    });
  }

  function handleExportKml() {
    const kml = exportRoutesToKml(routes);
    downloadKml("routes.kml", kml);
  }

  const visibleRoutes = routes;

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Rotas (MyMaps-style)</h2>
            <p className="text-xs opacity-70">Crie manualmente, importe/exporte KML ou gere a partir do histórico do rastreador.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={addRoute}>Nova rota</Button>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-white">
              Importar KML
              <input type="file" accept=".kml" className="hidden" onChange={handleImportKml} />
            </label>
            <Button variant="secondary" onClick={handleExportKml}>
              Exportar KML
            </Button>
            <Button onClick={() => persistRoutes(routes)}>Salvar</Button>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-white/80">Arquivos / layers</h3>
            <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
              {visibleRoutes.length === 0 && <p className="text-sm text-white/60">Nenhuma rota criada ainda.</p>}
              {visibleRoutes.map((route) => (
                <div
                  key={route.id}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                    selectedId === route.id ? "border-primary/60 bg-primary/10" : "border-white/10"
                  }`}
                >
                  <div>
                    <button
                      type="button"
                      className="text-left text-sm font-semibold text-white"
                      onClick={() => setSelectedId(route.id)}
                    >
                      {route.name}
                    </button>
                    <p className="text-xs text-white/60">{route.points?.length || 0} pontos</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={route.color || "#38bdf8"}
                      onChange={(event) => updateRoute(route.id, { color: event.target.value })}
                      aria-label="Cor"
                    />
                    <button
                      type="button"
                      className="rounded bg-white/10 px-2 py-1 text-xs"
                      onClick={() => deleteRoute(route.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {selectedRoute && (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
                <Input
                  label="Nome"
                  value={selectedRoute.name}
                  onChange={(event) => updateRoute(selectedRoute.id, { name: event.target.value })}
                />
                <p className="text-xs text-white/60">Clique no mapa para adicionar pontos à rota selecionada.</p>

                <form className="space-y-3" onSubmit={fetchHistoryRoute}>
                  <h4 className="text-sm font-semibold text-white">Gerar a partir do histórico</h4>
                  <Select
                    value={historyForm.deviceId}
                    onChange={(event) => setHistoryForm((current) => ({ ...current, deviceId: event.target.value }))}
                  >
                    <option value="">Selecione um dispositivo</option>
                    {deviceOptions.map((device) => (
                      <option key={device.value} value={device.value}>
                        {device.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    label="Início"
                    type="datetime-local"
                    value={historyForm.from}
                    onChange={(event) => setHistoryForm((current) => ({ ...current, from: event.target.value }))}
                  />
                  <Input
                    label="Fim"
                    type="datetime-local"
                    value={historyForm.to}
                    onChange={(event) => setHistoryForm((current) => ({ ...current, to: event.target.value }))}
                  />
                  <Button type="submit" disabled={loadingHistory || !historyForm.deviceId}>
                    {loadingHistory ? "Gerando..." : "Gerar rota do histórico"}
                  </Button>
                </form>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <MapContainer center={selectedRoute?.points?.[0] || DEFAULT_CENTER} zoom={13} style={{ height: 500 }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="OpenStreetMap" />
                <MapRouteCreator active={Boolean(selectedRoute)} onAddPoint={handleAddPoint} />
                {visibleRoutes.map((route) => (
                  <React.Fragment key={route.id}>
                    {route.points?.length ? <Polyline positions={route.points} pathOptions={{ color: route.color || "#38bdf8" }} /> : null}
                    {route.points?.[0] ? (
                      <Marker position={route.points[0]}>
                        <Popup>
                          <strong>{route.name}</strong>
                          <div>{route.points.length} pontos</div>
                        </Popup>
                      </Marker>
                    ) : null}
                  </React.Fragment>
                ))}
              </MapContainer>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
