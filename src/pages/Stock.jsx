import React, { useEffect, useMemo, useRef, useState } from 'react'
import PageHeader from '../ui/PageHeader'
import Field from '../ui/Field'
import Input from '../ui/Input'
import Button from '../ui/Button'
import LeafletMap from '../components/LeafletMap'
import { useTenant } from '../lib/tenant-context'
import { stockSummary } from '../mock/fleet'

async function fetchStock({ lat, lng, raioKm }) {
  // mock até conectar no backend
  const seed = Math.abs(Math.round((lat*1000)+(lng*1000)+raioKm))
  const disponiveis = (seed % 37) + 3
  const vinculados = (seed % 19) + 1
  const tecnicos   = (seed % 9)  + 1
  return { disponiveis, vinculados, tecnicos, total: disponiveis + vinculados }
}

async function geocodeOSM(q, signal){
  const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=8&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers:{Accept:'application/json'}, signal })
  if (!r.ok) throw new Error('Geocoding falhou')
  return r.json()
}

const Stat = ({title, value})=>(
  <div className="card flex flex-col gap-1">
    <div className="stat-title">{title}</div>
    <div className="stat-value">{value ?? '—'}</div>
  </div>
)

export default function Stock(){
  const { tenantId } = useTenant()
  const tenantStock = useMemo(() => stockSummary.find(item => item.tenantId === tenantId) || null, [tenantId])

  // endereço + sugestões
  const [query, setQuery]   = useState('')
  const [sugs, setSugs]     = useState([])
  const [loading, setLoading] = useState(false)
  const [openDD, setOpenDD] = useState(false)

  // centro escolhido + raio
  const [center, setCenter] = useState({ lat: -23.55, lng: -46.63, label: 'São Paulo, SP' })
  const [raio, setRaio]     = useState(50) // km

  // resultados
  const [summary, setSummary] = useState(tenantStock)
  const [running, setRunning] = useState(false)
  const [lastAt, setLastAt]   = useState('—')

  // debounce geocode
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
        setSugs(data.map(d=>({ label:d.display_name, lat:+d.lat, lng:+d.lon })))
        setOpenDD(true)
      }catch(e){ if(e.name!=='AbortError') console.warn(e) }
      finally{ setLoading(false) }
    }, 450)
    return ()=>{ clearTimeout(t); ac.abort() }
  }, [query])

  const escolher = (item)=>{
    setCenter({ lat:item.lat, lng:item.lng, label:item.label })
    setQuery(item.label)
    setOpenDD(false)
  }

  const clear = ()=>{
    setQuery('')
    setSugs([]); setOpenDD(false)
    setSummary(null); setLastAt('—')
  }

  const pesquisar = async ()=>{
    if (!center || Number.isNaN(center.lat) || Number.isNaN(center.lng)) return
    setRunning(true)
    try{
      const r = await fetchStock({ lat:center.lat, lng:center.lng, raioKm:+raio })
      setSummary(r)
      setLastAt(new Date().toLocaleString())
    } finally { setRunning(false) }
  }

  const RaioPreset = ({v})=>(
    <button
      type="button"
      className={`px-3 py-1 rounded-xl border ${+raio===v ? 'bg-stroke/60 border-stroke' : 'bg-card/60 border-stroke text-sub'}`}
      onClick={()=>setRaio(v)}
    >{v} km</button>
  )

  useEffect(()=>{ setSummary(tenantStock) }, [tenantStock])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Estoque"
        subtitle="Busque por endereço, defina o raio e visualize a distribuição."
      />

      {/* CONTROLES (acima do mapa) */}
      <Field label="Busca">
        <div className="grid lg:grid-cols-[1fr_auto] gap-3">
          <div className="addr-wrap">
            <Input
              placeholder={loading ? 'Buscando endereços…' : 'Digite um endereço (ex.: Rua, número, cidade)'}
              value={query}
              onChange={e=>setQuery(e.target.value)}
              onFocus={()=>{ if (sugs.length) setOpenDD(true) }}
            />
            {openDD && (
              <div className="addr-dd">
                {sugs.length===0
                  ? <div className="addr-empty">{loading ? 'Carregando…' : 'Nenhum resultado'}</div>
                  : sugs.map((s,i)=>(
                      <div key={i} className="addr-item" onClick={()=>escolher(s)}>{s.label}</div>
                    ))
                }
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Input
              type="number"
              placeholder="Raio (km)"
              value={raio}
              onChange={e=>setRaio(Math.max(1, +e.target.value || 1))}
            />
            <Button onClick={pesquisar} disabled={running || !query.trim()}>
              {running ? 'Pesquisando…' : 'Pesquisar'}
            </Button>
            <Button onClick={clear}>Limpar</Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-sm text-sub">Presets:</span>
          <RaioPreset v={10}/><RaioPreset v={25}/><RaioPreset v={50}/><RaioPreset v={100}/>
          {center.label && <span className="text-sm text-sub ml-auto">Selecionado: {center.label}</span>}
        </div>
      </Field>

      {/* CONTEÚDO: mapa à esquerda, cards à direita */}
      <div className="grid gap-3 lg:grid-cols-[minmax(440px,1fr)_380px]">
        <Field label="Mapa">
          <LeafletMap center={[center.lat, center.lng]} markers={[{ lat:center.lat, lng:center.lng, label:center.label }]} zoom={tenantStock ? 8 : 5} />
        </Field>

        <div className="grid gap-3">
          <Field label="Resumo">
            <div className="grid grid-cols-2 gap-3">
              <Stat title="Disponíveis" value={summary?.disponiveis}/>
              <Stat title="Vinculados"  value={summary?.vinculados}/>
              <Stat title="Total"        value={summary?.total}/>
              <Stat title="Técnicos"     value={summary?.tecnicos}/>
            </div>
            <div className="mt-3 text-sm text-sub">Última consulta: {lastAt}</div>
          </Field>

          <Field label="Próximos passos">
            <ul className="list-disc pl-5 text-sm text-sub space-y-1">
              <li>Filtros por cliente/técnico (quando conectar ao backend).</li>
              <li>Desenhar círculo do raio no mapa (quando `LeafletMap` aceitar props).</li>
              <li>Exportar CSV/PDF da região consultada.</li>
            </ul>
          </Field>
        </div>
      </div>
    </div>
  )
}
