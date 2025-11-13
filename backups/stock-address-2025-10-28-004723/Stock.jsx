import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Field from '../ui/Field'
import Input from '../ui/Input'
import Button from '../ui/Button'
import LeafletMap from '../components/LeafletMap'

export default function Stock(){
  const [lat, setLat] = useState(-19.9)
  const [lng, setLng] = useState(-43.9)
  const [raio, setRaio] = useState(50) // km
  const pesquisar = ()=>{ console.log('ESTOQUE_PESQUISA',{lat,lng,raio}) }

  return (
    <Layout title="Estoque">
      <PageHeader title="Estoque por região" subtitle="Pesquise por região no mapa e aplique um raio." />
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="Mapa">
          <LeafletMap />
          <div className="grid md:grid-cols-3 gap-2 mt-3">
            <Input placeholder="Latitude" value={lat} onChange={e=>setLat(Number(e.target.value))}/>
            <Input placeholder="Longitude" value={lng} onChange={e=>setLng(Number(e.target.value))}/>
            <Input placeholder="Raio (km)" value={raio} onChange={e=>setRaio(Number(e.target.value))}/>
          </div>
          <div className="mt-2"><Button onClick={pesquisar}>Pesquisar</Button></div>
        </Field>

        <Field label="Resumo">
          <div className="grid grid-cols-2 gap-3">
            <div className="card"><div className="stat-title">Disponíveis</div><div className="stat-value">0</div></div>
            <div className="card"><div className="stat-title">Vinculados</div><div className="stat-value">0</div></div>
            <div className="card"><div className="stat-title">Total</div><div className="stat-value">0</div></div>
            <div className="card"><div className="stat-title">Técnicos</div><div className="stat-value">0</div></div>
          </div>
          <div className="mt-3 text-sm muted">Também podemos abrir abas “por região / por cliente / por técnico”.</div>
        </Field>
      </div>
    </Layout>
  )
}
