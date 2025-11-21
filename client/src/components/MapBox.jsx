import React from 'react'
export default function MapBox({center={lat:0,lng:0}, radiusKm=0}) {
  return (
    <div className="w-full h-72 rounded-xl border border-stroke bg-card flex items-center justify-center text-sm muted">
      Mapa aqui • centro: {center.lat.toFixed(4)}, {center.lng.toFixed(4)} • raio: {radiusKm} km
    </div>
  )
}
