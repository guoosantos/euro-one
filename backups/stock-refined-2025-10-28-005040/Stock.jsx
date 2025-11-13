import React, { useEffect, useMemo, useRef, useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Field from '../ui/Field'
import Input from '../ui/Input'
import Button from '../ui/Button'
import LeafletMap from '../components/LeafletMap'

/** Simulação de contadores até integrar com o backend real */
async function fetchStock({ lat, lng, raioKm }) {
  const seed = Math.abs(Math.round((lat*1000)+(lng*1000)+raioKm))
  const disponiveis = (seed % 37) + 3
  const vinculados = (seed % 19) + 1
  const tecnicos   = (seed % 9)  + 1
  return { disponiveis, vinculados, tecnicos }
}

/** Geocoding Nominatim (OSM) com debounce e cancelamento */
async function geocodeOSM(q, signal){
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`
  const r = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    signal
  })
  if (!r.ok) throw new Error('Geocoding falhou')
  return r.json()
}

export default function Stock(){
  // Estado da busca
  const [query, setQuery] = useState('')
  const [sugs, setSugs] = useState([])          // sugestões
  const [loading, setLoading] = useState(false)
  const [openDD, setOpenDD] = useState(false)

  // Posição selecionada + raio
  const [center, setCenter] = useState({ lat: -23.55, lng: -46.63, label: '' })
  const [raio, setRaio] = useState(50) // km

  // Resumo
  const [summary, setSummary] = useState(null)
  const [running, setRunning] = useState(false)

  // Debounce do geocode
  const acRef = useRef(null)
  useEffect(()=>{
    if (query.trim().length < 3){ setSugs([]); setOpenDD(false); return }
    setLoading(true)
    const ac = new AbortController()
    acRef.current?.abort()
    acRef.current = ac
    const t = setTimeout(async ()=>{
      try{
        const data = await geocodeOSM(query.trim(), ac.signal)
        setSugs(data.map(d=>({
          label: d.display_name,
          lat: parseFloat(d.lat),
          lng: parseFloat(d.lon)
        })))
        setOpenDD(true)
      } catch(e){ if (e.name!=='AbortError') console.warn(e) }
      finally{ setLoading(false) }
    }, 450)
    return ()=>{ clearTimeout(t); ac.abort() }
  }, [query])

  const escolher = (item)=>{
    setCenter({ lat:item.lat, lng:item.lng, label:item.label })
    setQuery(item.label)
    setOpenDD(false)
  }

  const pesquisar = async ()=>{
    if (!center || Number.isNaN(center.lat) || Number.isNaN(center.lng)) return
    setRunning(true)
    try{
      const r = await fetchStock({ lat:center.lat, lng:center.lng, raioKm:+raio })
      setSummary({ disponiveis:r.disponiveis, vinculados:r.vinculados, tecnicos:r.tecnicos, total:r.disponiveis+r.vinculados })
    } finally { setRunning(false) }
  }

  const Stat = ({title, value})=>(
    <div className="card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value ?? '0'}</div>
    </div>
  )

  return (
    <Layout title="Estoque">
      <PageHeader title="Estoque" subtitle="Pesquise por endereço e aplique um raio." />

      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Mapa">
          {/* Mantém o mapa atual; se seu LeafletMap aceitar props, depois plugamos center/raio */}
          <LeafletMap />
          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <div className="addr-wrap md:col-span-2">
              <Input
                placeholder={loading ? 'Buscando endereços…' : 'Digite um endereço (ex.: Rua, número, cidade)'}
                value={query}
                onChange={e=>setQuery(e.target.value)}
                onFocus={()=>{ if (sugs.length) setOpenDD(true) }}
              />
              {openDD && (
                <div className="addr-dd">
                  {sugs.length === 0 ? (
                    <div className="addr-empty">{loading ? 'Carregando…' : 'Nenhum resultado'}</div>
                  ) : sugs.map((s, i)=>(
                    <div key={i} className="addr-item" onClick={()=>escolher(s)}>{s.label}</div>
                  ))}
                </div>
              )}
            </div>
            <Input placeholder="Raio (km)" type="number" value={raio} onChange={e=>setRaio(Math.max(1, +e.target.value || 1))}/>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Button onClick={pesquisar} disabled={running || !query.trim()}>
              {running ? 'Pesquisando…' : 'Pesquisar'}
            </Button>
            {center.label && <div className="text-sm text-sub">Selecionado: {center.label}</div>}
          </div>
        </Field>

        <Field label="Resumo">
          <div className="grid grid-cols-2 gap-3">
            <Stat title="Disponíveis" value={summary?.disponiveis} />
            <Stat title="Vinculados"  value={summary?.vinculados}  />
            <Stat title="Total"        value={summary?.total}       />
            <Stat title="Técnicos"     value={summary?.tecnicos}    />
          </div>
          {!summary && <div className="mt-3 text-sm muted">Busque um endereço e clique em “Pesquisar” para ver os números.</div>}
        </Field>
      </div>
    </Layout>
  )
}
