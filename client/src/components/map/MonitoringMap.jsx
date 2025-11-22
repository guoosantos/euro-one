import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_CENTER = [-19.85703, -43.95919]; // BH
const DEFAULT_ZOOM = 12;

/**
 * Mapa de monitoramento básico usando Leaflet.
 * Não depende de WebSocket nem de MapLibre.
 * Aceita props mas, por enquanto, só usa center/zoom.
 */
export default function MonitoringMap(props) {
  const {
    center = DEFAULT_CENTER,
    zoom = DEFAULT_ZOOM,
    // no futuro dá pra usar essas props pra desenhar marcadores:
    // positions, selectedDeviceId, etc...
    ...rest
  } = props;

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // cria o mapa só uma vez
    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current).setView(center, zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      mapRef.current = map;
    } else {
      // atualiza centro/zoom quando mudar
      mapRef.current.setView(center, zoom);
    }

    return () => {
      // cleanup ao desmontar o componente
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [center[0], center[1], zoom]);

  return (
    <div
      ref={mapContainerRef}
      style={{ width: "100%", height: "100%" }}
      {...rest}
    />
  );
}
