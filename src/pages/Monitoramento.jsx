import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { CoreApi } from "../lib/coreApi";

// arruma ícones default no Vite
import L from "leaflet";
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function Monitoramento(){
  const [points, setPoints] = useState([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const devs = await CoreApi.listDevices();
      const pick = (Array.isArray(devs)?devs:[]).slice(0,100);
      const entries = await Promise.all(pick.map(async d => {
        const p = await CoreApi.lastPosition(d.id);
        return p ? ({...p, deviceId: d.id, name: d.name || d.uniqueId || d.id}) : null;
      }));
      if (!live) return;
      setPoints(entries.filter(Boolean));
    })();
    return ()=>{ live = false; };
  }, []);

  const center = points.length ? [points[0].latitude || points[0].lat, points[0].longitude || points[0].lon] : [-15.78, -47.93];

  return (
    <div className="w-full h-[calc(100vh-80px)]">
      <MapContainer center={center} zoom={5} style={{height:"100%", width:"100%"}}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {points.map(p => {
          const lat = p.latitude ?? p.lat; const lon = p.longitude ?? p.lon;
          if (typeof lat !== "number" || typeof lon !== "number") return null;
          return (
            <Marker key={p.deviceId} position={[lat, lon]}>
              <Popup>
                <div style={{minWidth:200}}>
                  <div><b>{p.name}</b></div>
                  <div>Lat: {lat.toFixed(5)} Lon: {lon.toFixed(5)}</div>
                  {p.speed!=null && <div>Veloc.: {p.speed} km/h</div>}
                  {p.fixTime && <div>Fix: {new Date(p.fixTime).toLocaleString()}</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}
