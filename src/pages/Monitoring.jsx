import React, { useMemo, useState } from 'react';
import useDevices from '../lib/hooks/useDevices';

// NOTE:
// This file resolves merge conflicts by keeping the stable layout and injecting the new telemetry usage.
// It preserves the topbar/sidebar as they were expected to be in the original file (imports kept minimal).
// If your project uses different Topbar/Sidebar/Map components, adjust the imports below to match existing ones.

import Topbar from '../components/Topbar';
import Sidebar from '../components/Sidebar';

// Map rendering: try to use react-leaflet if available, otherwise fallback to simple list representation.
// This makes the page work even if the project does not use Leaflet; the fallback still shows positions.
let MapView;
try {
  // eslint-disable-next-line
  const RL = require('react-leaflet');
  const { MapContainer, TileLayer, Marker, Popup } = RL;
  MapView = function LeafletMap({ positions }) {
    const markers = Object.values(positions || {});
    const center = markers.length
      ? [markers[0].latitude ?? markers[0].lat ?? 0, markers[0].longitude ?? markers[0].lon ?? markers[0].lng ?? 0]
      : [0, 0];
    return (
      <MapContainer center={center} zoom={6} style={{ height: '400px', width: '100%' }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {markers.map((pos) => {
          const lat = pos.latitude ?? pos.lat ?? pos.latitude_deg ?? pos.lat_deg;
          const lon = pos.longitude ?? pos.lon ?? pos.lng ?? pos.lng_deg;
          const name = pos.name ?? pos.deviceName ?? pos.deviceid ?? `Device ${pos.deviceId ?? pos.device_id}`;
          const speed = pos.speed ?? pos.attributes?.speed ?? 0;
          const ignition = pos.attributes?.ignition ?? pos.ignition ?? null;
          const status = '—';
          return (
            <Marker key={pos.deviceId ?? pos.device_id ?? JSON.stringify(pos)} position={[lat, lon]}>
              <Popup>
                <div style={{ minWidth: 180 }}>
                  <div><strong>{name}</strong></div>
                  <div>Velocidade: {speed ? `${speed} km/h` : '—'}</div>
                  <div>Ignição: {ignition === null ? '—' : ignition ? 'Sim' : 'Não'}</div>
                  <div>Endereço: {pos.address ?? pos.attributes?.address ?? '—'}</div>
                  <div>Server time: {pos.serverTime ?? pos.time ?? '—'}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    );
  };
} catch (e) {
  MapView = function FallbackMap({ positions }) {
    const markers = Object.values(positions || {});
    return (
      <div style={{ height: 400, overflow: 'auto', padding: 8, border: '1px solid #ddd' }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Mapa (lista de posições - fallback)</div>
        {markers.length === 0 && <div>Nenhuma posição disponível</div>}
        {markers.map((pos) => (
          <div key={pos.deviceId ?? pos.device_id} style={{ padding: 6, borderBottom: '1px solid #eee' }}>
            <div><strong>{pos.name ?? pos.deviceName ?? pos.deviceId}</strong></div>
            <div>Lat: {pos.latitude ?? pos.lat ?? '—'}</div>
            <div>Lon: {pos.longitude ?? pos.lon ?? '—'}</div>
            <div>Velocidade: {pos.speed ?? '—'}</div>
          </div>
        ))}
      </div>
    );
  };
}

// Simple helper to determine online/offline based on position timestamp
function isOnline(position, offlineThresholdMinutes = 5) {
  if (!position) return false;
  const timeStr = position.serverTime ?? position.time ?? position.fixTime ?? position.server_time ?? position.fixtime;
  if (!timeStr) return false;
  const t = Date.parse(timeStr);
  if (Number.isNaN(t)) return false;
  const diffMin = (Date.now() - t) / 1000 / 60;
  return diffMin <= offlineThresholdMinutes;
}

export default function Monitoring() {
  const { devices, positionsByDeviceId, loading, error, reload, stats } = useDevices();

  const [query, setQuery] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState({
    name: true,
    plate: true,
    speed: true,
    ignition: true,
    status: true,
  });

  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return devices || [];
    return (devices || []).filter((d) => {
      const name = (d.name ?? d.vehicle ?? d.alias ?? '').toString().toLowerCase();
      const plate = (d.plate ?? d.registrationNumber ?? d.uniqueId ?? '').toString().toLowerCase();
      return name.includes(q) || plate.includes(q);
    });
  }, [devices, query]);

  return (
    <div className="app-root" style={{ display: 'flex', height: '100vh' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Topbar />
        <main style={{ padding: 16, overflow: 'auto' }}>
          <h1>Monitoramento</h1>

          {/* Search + Columns button */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <input
              placeholder="Buscar veículo / placa"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ padding: 8, flex: 1, marginRight: 8 }}
            />
            <div style={{ position: 'relative' }}>
              <button onClick={() => setShowColumns((s) => !s)}>Colunas</button>
              {showColumns && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    marginTop: 6,
                    padding: 8,
                    background: '#fff',
                    border: '1px solid #ddd',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                    zIndex: 50,
                  }}
                >
                  <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Exibir colunas</div>
                  {Object.keys(columns).map((key) => (
                    <label key={key} style={{ display: 'block', marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={columns[key]}
                        onChange={() => setColumns((c) => ({ ...c, [key]: !c[key] }))}
                      />{' '}
                      {key[0].toUpperCase() + key.slice(1)}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={reload} style={{ marginLeft: 8 }}>
              Recarregar
            </button>
          </div>

          {/* Top row: Map (left) and Summary (right) */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 2 }}>
              <div style={{ border: '1px solid #ddd', padding: 8 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Mapa</div>
                <MapView positions={positionsByDeviceId} />
              </div>
            </div>

            <div style={{ width: 320 }}>
              <div style={{ border: '1px solid #ddd', padding: 12 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Resumo</div>
                <div>Total de dispositivos: {stats.total}</div>
                <div>Com posição: {stats.withPosition}</div>
                <div style={{ marginTop: 8 }}>
                  {loading && <div>Carregando dados de telemetria...</div>}
                  {error && <div style={{ color: 'red' }}>Erro ao carregar: {error.message}</div>}
                </div>
              </div>
            </div>
          </div>

          {/* Devices table */}
          <div style={{ border: '1px solid #ddd', padding: 8 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Veículos / Dispositivos</div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {columns.name && <th style={{ textAlign: 'left', padding: 6 }}>Nome</th>}
                  {columns.plate && <th style={{ textAlign: 'left', padding: 6 }}>Placa</th>}
                  {columns.speed && <th style={{ textAlign: 'left', padding: 6 }}>Velocidade (km/h)</th>}
                  {columns.ignition && <th style={{ textAlign: 'left', padding: 6 }}>Ignição</th>}
                  {columns.status && <th style={{ textAlign: 'left', padding: 6 }}>Status</th>}
                </tr>
              </thead>
              <tbody>
                {(filtered || []).map((d) => {
                  const deviceId = d.id ?? d.deviceId ?? d.device_id ?? d.uniqueId ?? d.unique_id;
                  const pos = positionsByDeviceId[deviceId] ?? positionsByDeviceId[d.uniqueId] ?? positionsByDeviceId[d.unique_id];
                  const speed = pos?.speed ?? pos?.attributes?.speed ?? null;
                  const ignition = pos?.attributes?.ignition ?? d.attributes?.ignition ?? null;
                  const online = isOnline(pos);
                  return (
                    <tr key={deviceId} style={{ borderTop: '1px solid #f0f0f0' }}>
                      {columns.name && <td style={{ padding: 6 }}>{d.name ?? d.vehicle ?? d.alias ?? '—'}</td>}
                      {columns.plate && <td style={{ padding: 6 }}>{d.plate ?? d.registrationNumber ?? '—'}</td>}
                      {columns.speed && <td style={{ padding: 6 }}>{speed != null ? `${speed} km/h` : '—'}</td>}
                      {columns.ignition && <td style={{ padding: 6 }}>{ignition === null ? '—' : ignition ? 'Sim' : 'Não'}</td>}
                      {columns.status && <td style={{ padding: 6 }}>{online ? 'Online' : 'Offline'}</td>}
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={Object.values(columns).filter(Boolean).length} style={{ padding: 8 }}>
                      Nenhum dispositivo encontrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
