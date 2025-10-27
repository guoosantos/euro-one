import LTextArea from '../ui/LTextArea';
import LSelect from '../ui/LSelect';
import LInput from '../ui/LInput';
import React, { useState } from 'react';
import Layout from '../layout/Layout';
import PageHeader from '../ui/PageHeader';
import Field from '../ui/Field';
import Button from '../ui/Button';
import AddressAutocomplete from '../components/AddressAutocomplete';

async function fetchStock({ lat, lng, raioKm }) {
  const seed = Math.abs(Math.round((lat*1000)+(lng*1000)+raioKm));
  const disponiveis = (seed % 37) + 3;
  const vinculados = (seed % 19) + 1;
  const tecnicos   = (seed % 9)  + 1;
  return { disponiveis, vinculados, tecnicos };
}

export default function Stock(){
  const [center, setCenter]   = useState(null);   // {lat,lng,address}
  const [address, setAddress] = useState('');
  const [raio, setRaio]       = useState(50);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  const pesquisar = async ()=>{
    if (!center) return;
    setLoading(true);
    try {
      const r = await fetchStock({ lat:center.lat, lng:center.lng, raioKm:raio });
      setSummary({
        disponiveis: r.disponiveis,
        vinculados: r.vinculados,
        tecnicos:   r.tecnicos,
        total:      r.disponiveis + r.vinculados,
      });
    } finally { setLoading(false); }
  };

  const Stat = ({title, value})=>(
    <div className="card">
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value ?? '—'}</div>
    </div>
  );

  return (
    <Layout title="Estoque">
      <PageHeader title="Estoque por região" subtitle="Pesquise por endereço (Google) e aplique um raio." />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Bloco de pesquisa */}
        <Field label="Pesquisa">
          <div className="grid md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <div className="lwrap"><span className="legend">Endereço</span><AddressAutocomplete
                label="Endereço"
                placeholder="Rua, número, cidade…"
                className="pill"
                inputClassName="pill-input"
                onSelect={(p)=></div>{ setCenter({lat:p.lat,lng:p.lng,address:p.address}); setAddress(p.address); }}
              />
            </div>
            <div className="">
              <div className="pill">
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={raio}
                  onChange={(e)=>setRaio(Number(e.target.value)||0)}
                  placeholder="Raio (km)"
                />
              </div>
            </div>
            <div className="md:col-span-3 flex items-center gap-3">
              <Button disabled={!center || loading} onClick={pesquisar}>
                {loading ? 'Buscando…' : 'Pesquisar'}
              </Button>
              <span className="muted">
                {center ? `Centro: ${center.address} • Raio: ${raio} km` : 'Escolha um endereço para habilitar a pesquisa.'}
              </span>
            </div>
          </div>
        </Field>

        {/* Resumo */}
        <div className="grid grid-cols-2 gap-3">
          <Stat title="Disponíveis" value={summary?.disponiveis}/>
          <Stat title="Vinculados" value={summary?.vinculados}/>
          <Stat title="Total" value={summary?.total}/>
          <Stat title="Técnicos" value={summary?.tecnicos}/>
          {!summary && <div className="muted col-span-2">Sem pesquisa: os números ficam “—”.</div>}
        </div>
      </div>

      {/* Mapa/preview (placeholder visual) */}
      <Field label="Mapa (visual)">
        <div className="card h-[320px] flex items-center justify-center muted">
          {center ? `${address} • raio ${raio} km` : 'Aguardando endereço…'}
        </div>
      </Field>
    </Layout>
  );
}
