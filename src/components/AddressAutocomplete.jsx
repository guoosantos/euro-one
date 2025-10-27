import React, { useEffect, useRef, useState } from 'react'
import { loadGooglePlaces } from '../lib/google'

export default function AddressAutocomplete({label='Endereço', onSelect, placeholder='Rua, número, cidade…'}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const serviceRef = useRef(null)

  useEffect(()=>{ // tenta carregar Google Places — se não tiver chave, vira input simples
    loadGooglePlaces().then(g=>{
      if (g?.maps?.places) {
        serviceRef.current = new g.maps.places.AutocompleteService()
      }
    })
  },[])

  useEffect(()=>{
    const svc = serviceRef.current
    if (!svc || !query || query.length < 3){ setItems([]); return }
    const request = { input: query, componentRestrictions:{ country: ['br'] } }
    svc.getPlacePredictions(request, (preds)=> {
      setItems((preds||[]).map(p=>({ id:p.place_id, main:p.structured_formatting.main_text, sec:p.structured_formatting.secondary_text })))
    })
  },[query])

  function choose(it){
    // Quando não temos detalhes, repassamos só o texto; o map real usará geocode no backend
    setOpen(false); setQuery(`${it.main}${it.sec?' - '+it.sec:''}`)
    onSelect?.({ lat: -23.5505, lng: -46.6333, address: `${it.main}${it.sec?' - '+it.sec:''}` }) // centro fictício (SP) só para UI
  }

  return (
    <div className="lwrap ac-wrap">
      <span className="legend">{label}</span>
      <input
        className="linput ac-input"
        value={query}
        onChange={e=>{ setQuery(e.target.value); setOpen(true) }}
        onFocus={()=>setOpen(true)}
        onBlur={()=>setTimeout(()=>setOpen(false), 100)}
        placeholder={placeholder}
      />
      {open && items.length>0 && (
        <div className="ac-menu">
          {items.map(it=>(
            <div key={it.id} className="ac-item" onMouseDown={()=>choose(it)}>
              <div>
                <div>{it.main}</div>
                {it.sec && <small>{it.sec}</small>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
