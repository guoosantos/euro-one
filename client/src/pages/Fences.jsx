import React, { useMemo, useState } from "react";
import { MapContainer, TileLayer, Circle, Polygon, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import useDevices from "../lib/hooks/useDevices";
import { useGeofences } from "../lib/hooks/useGeofences";
import { buildGeofencePayload, decodeGeofencePolygon } from "../lib/geofence-utils";

const DEFAULT_CENTER = [-23.55052, -46.633308];

function GeofenceDesigner({ shape, onAddPoint }) {
  useMapEvents({
    click(event) {
      onAddPoint([event.latlng.lat, event.latlng.lng]);
    },
  });
  if (shape.type === "circle" && shape.center) {
    return <Circle center={shape.center} radius={shape.radius} pathOptions={{ color: "#38bdf8" }} />;
  }
  if (shape.type === "polygon" && shape.points.length >= 3) {
    return <Polygon positions={shape.points} pathOptions={{ color: "#22c55e" }} />;
  }
  return null;
}

export default function Fences() {
  const { geofences, loading, error, createGeofence, updateGeofence, assignToDevice } = useGeofences({ autoRefreshMs: 60_000 });
  const { devices: deviceList } = useDevices();
  const devices = useMemo(() => (Array.isArray(deviceList) ? deviceList : []), [deviceList]);

  const [name, setName] = useState("");
  const [shapeType, setShapeType] = useState("circle");
  const [radius, setRadius] = useState(500);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [points, setPoints] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("all");
  const [saving, setSaving] = useState(false);

  const shape = useMemo(
    () => ({ type: shapeType, radius, center, points }),
    [shapeType, radius, center, points],
  );

  const existing = useMemo(() => (Array.isArray(geofences) ? geofences : []), [geofences]);

  function handleAddPoint(point) {
    if (shapeType === "circle") {
      setCenter(point);
    } else {
      setPoints((prev) => [...prev, point]);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = buildGeofencePayload({ name, shapeType, radius, center, points });
      const geofence = await createGeofence(payload);
      if (selectedDevice !== "all" && geofence?.id) {
        await assignToDevice({ geofenceId: geofence.id, deviceId: selectedDevice });
      }
      setName("");
      setPoints([]);
    } catch (submitError) {
      console.error("Failed to create geofence", submitError);
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(geofence) {
    setSaving(true);
    try {
      const payload = buildGeofencePayload({
        name: geofence.name,
        shapeType: geofence.type,
        radius: geofence.radius,
        center: [geofence.latitude, geofence.longitude],
        points: geofence.area ? decodeGeofencePolygon(geofence.area) : [],
      });
      await updateGeofence(geofence.id, payload);
    } catch (updateError) {
      console.error("Failed to update geofence", updateError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4">
        <header>
          <h2 className="text-lg font-semibold">Cercas inteligentes</h2>
          <p className="text-xs opacity-70">
            Clique no mapa para definir o centro da cerca ou desenhar um polígono. Você pode associar a um dispositivo.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm">
              <span className="text-xs uppercase tracking-wide opacity-60">Nome</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-xs uppercase tracking-wide opacity-60">Formato</span>
                <select
                  value={shapeType}
                  onChange={(event) => {
                    setShapeType(event.target.value);
                    setPoints([]);
                  }}
                  className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
                >
                  <option value="circle">Círculo</option>
                  <option value="polygon">Polígono</option>
                </select>
              </label>

              {shapeType === "circle" && (
                <label className="text-sm">
                  <span className="text-xs uppercase tracking-wide opacity-60">Raio (m)</span>
                  <input
                    type="number"
                    min={50}
                    step={50}
                    value={radius}
                    onChange={(event) => setRadius(Number(event.target.value))}
                    className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                </label>
              )}
            </div>

            <label className="block text-sm">
              <span className="text-xs uppercase tracking-wide opacity-60">Associar a dispositivo</span>
              <select
                value={selectedDevice}
                onChange={(event) => setSelectedDevice(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-layer px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="all">Somente salvar</option>
                {devices.map((device) => (
                  <option key={device.id ?? device.deviceId ?? device.uniqueId} value={device.id ?? device.deviceId ?? device.uniqueId}>
                    {device.name ?? device.uniqueId ?? device.id}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={saving || !name}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Salvando…" : "Criar geofence"}
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-border">
            <MapContainer center={center} zoom={14} style={{ height: 360 }} className="bg-layer">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <GeofenceDesigner shape={shape} onAddPoint={handleAddPoint} />
            </MapContainer>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Geofences cadastradas</h3>
            <p className="text-xs opacity-70">Atualização automática a cada minuto.</p>
          </div>
          <span className="text-xs opacity-60">
            {loading ? "Carregando cercas…" : `${existing.length} cercas ativas`}
          </span>
        </header>

        {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error.message}</div>}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider opacity-60">
              <tr>
                <th className="py-2 pr-6">Nome</th>
                <th className="py-2 pr-6">Tipo</th>
                <th className="py-2 pr-6">Centro</th>
                <th className="py-2 pr-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {existing.map((geofence) => (
                <tr key={geofence.id} className="hover:bg-white/5">
                  <td className="py-2 pr-6 text-white">{geofence.name}</td>
                  <td className="py-2 pr-6 text-white/70">{geofence.type}</td>
                  <td className="py-2 pr-6 text-white/70">
                    {formatCoordinate(geofence.latitude, geofence.longitude)}
                  </td>
                  <td className="py-2 pr-6">
                    <button
                      type="button"
                      className="rounded-lg border border-border px-3 py-1 text-xs hover:bg-white/10"
                      onClick={() => handleUpdate(geofence)}
                    >
                      Sincronizar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatCoordinate(lat, lon) {
  if (!lat || !lon) return "—";
  return `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`;
}
