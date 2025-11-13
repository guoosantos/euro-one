import React, { useEffect, useRef, useState } from 'react'
import { loadGooglePlaces } from '../lib/google'

export default function AddressAutocomplete({label='Endereço', onSelect, placeholder='Digite um endereço'}) {
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const serviceRef = useRef(null); const placesRef = useRef(null); const mapDiv = useRef(null)

  useEffect(()=>{ loadGooglePlaces().then((g)=>{
    if(!g) return; serviceRef.current = new g.maps.places.AutocompleteService()
    const map = new g.maps.Map(mapDiv.current||document.createElement('div'))
    placesRef.current = new g.maps.places.PlacesService(map); setReady(true)
  }) },[])

  useEffect(()=>{
    const s = serviceRef.current
    if(!s || !query){ setItems([]); return }
    s.getPlacePredictions({ input: query, componentRestrictions:{ country:['br'] } }, (pred=[])=> setItems(pred))
  },[query])

  const pick = (it)=>{
    const p = placesRef.current; if(!p) return setQuery(it.description)
    p.getDetails({placeId: it.place_id, fields:['geometry','formatted_address']}, (d)=>{
      if(!d?.geometry) return
      const loc = d.geometry.location
      onSelect && onSelect({ address: d.formatted_address, lat: loc.lat(), lng: loc.lng() })
      setQuery(d.formatted_address); setItems([])
    })
  }

  return (
    <div className="lwrap relative">
      <span className="legend">{label}</span>
      <input className="linput" placeholder={placeholder} value={query} onChange={e=>setQuery(e.target.value)}/>
      {!!items.length && ready && (
        <div className="absolute z-30 left-0 right-0 mt-2 bg-bg border border-stroke rounded-xl max-h-64 overflow-auto">
          {items.map(it=>(
            <div key={it.place_id} className="px-3 py-2 hover:bg-card cursor-pointer text-sm" onMouseDown={()=>pick(it)}>{it.description}</div>
          ))}
        </div>
      )}
      <div ref={mapDiv} style={{display:'none'}} />
    </div>
  )
}
