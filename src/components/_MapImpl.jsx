import React from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

const icon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34],
  shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
})

export default function MapImpl({ center=[-23.55,-46.63], zoom=11, markers=[] }){
  return (
    <div className="card p-0 overflow-hidden" style={{height: 420}}>
      <MapContainer center={center} zoom={zoom} style={{height:'100%',width:'100%'}}>
        <TileLayer url={import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'} />
        {markers.map((m,i)=> <Marker key={i} position={[m.lat,m.lng]} icon={icon}><Popup>{m.label||'Veículo'}</Popup></Marker>)}
      </MapContainer>
    </div>
  )
}
