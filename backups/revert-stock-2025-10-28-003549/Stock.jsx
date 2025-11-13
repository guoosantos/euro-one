import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Field from '../ui/Field'
import Button from '../ui/Button'
import LInput from '../ui/LInput'
import { geocodeAddress } from '../lib/geocode'

/** MOCK até ligar com seu backend:
 * troque por GET /api/stock?lat=..&lng=..&raioKm=..  */
async function fetchStock({ lat, lng, raioKm }) {
  const seed = Math.abs(Math.round((lat*1000)+(lng*1000)+raioKm))
  const disponiveis = (seed % 37) + 3
  const vinculados = (seed % 19) + 1
  const tecnicos   = (seed % 9)  + 1
  return { disponiveis, vinculados, tecnicos }
}

export default function Stock(){
  const [address, setAddress] = useState('')
  const [center, setCenter]   = useState(null) // {lat,lng,address}
  const [raio, setRaio]       = useState(50)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr]         = useState('')

  async function pesquisar(){
    setErr('')
    if (!address.trim()) { setErr('Digite um endereço.'); return }
    setLoading(true)
    try{
      const g = await geocodeAddress(address.trim())
      if (!g) { setErr('Endereço não encontrado. Tente ser mais específico.'); return }
      setCenter(g)
      const r = await fetchStock({ lat:g.lat, lng:g.lng, raioKm:raio })
      setSummary({
        disponiveis: r.disponiveis,
        vinculados:  r.vinculados,
        tecnicos:    r.tecnicos,
        total:       r.disponiveis + r.vinculados
      })
    } catch(e){
      setErr('Falha ao pesquisar. Verifique sua conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const Stat = ({title, value})=>(
    <div className="card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  )

  return (
    <Layout title="Estoque">
      <PageHeader
        title="Estoque por região"
        subtitle="Pesquise por endereço e aplique um raio."
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Bloco de pesquisa */}
        <Field label="Pesquisa">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <LInput
                label="Endereço"
                placeholder="Rua, número, cidade..."
                value={address}
                onChange={e=>setAddress(e.target.value)}
              />
            </div>
            <LInput
              label="Raio (km)"
              type="number"
              min={1}
              value={raio}
              onChange={e=>setRaio(Math.max(1, +e.target.value || 1))}
            />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <Button onClick={pesquisar} disabled={loading}>
              {loading ? 'Pesquisando...' : 'Pesquisar'}
            </Button>
            <div className="text-sub">
              {center
                ? `Centro: ${center.address} • Raio: ${raio} km`
                : 'Escolha um endereço para habilitar a pesquisa.'}
            </div>
          </div>
          {!!err && <div className="mt-2 text-red-400 text-sm">{err}</div>}
        </Field>

        {/* Resumo */}
        <Field label="Resumo">
          <div className="grid grid-cols-2 gap-3">
            <Stat title="Disponíveis" value={summary?.disponiveis} />
            <Stat title="Vinculados"  value={summary?.vinculados}  />
            <Stat title="Total"        value={summary?.total}       />
            <Stat title="Técnicos"     value={summary?.tecnicos}    />
          </div>
          {!summary && <div className="mt-3 text-sub">Sem pesquisa: os números ficam “—”.</div>}
        </Field>
      </div>

      {/* Mapa visual (placeholder simples, mantendo layout) */}
      <div className="mt-3">
        <Field label="Mapa (visual)">
          <div className="h-[360px] rounded-xl border border-[var(--card-border,#2a3140)] bg-[rgba(19,23,33,.45)] flex items-center justify-center text-sub">
            {center ? `Centro: ${center.lat.toFixed(5)}, ${center.lng.toFixed(5)} — ${center.address}` : 'Aguardando endereço…'}
          </div>
        </Field>
      </div>
    </Layout>
  )
}
