import React from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { Table, Pager } from '../ui/Table'
import LeafletMap from '../components/LeafletMap'
import { Search } from 'lucide-react'

export default function Trips(){
  return (
    <Layout title="Trajetos">
      <PageHeader title="Trajetos" subtitle="Selecione um trajeto para reproduzir o caminho no mapa e ver eventos."
        right={<Button>Atualizar</Button>}
      />

      <div className="card">
        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Input placeholder="Buscar (origem, destino, veículo, entrega)" icon={Search}/>
          <Input type="date" />
          <Input type="date" />
          <label className="flex items-center gap-2 text-sm text-sub"><input type="checkbox" className="accent-primary"/> Pendentes</label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 mt-3">
        <div className="card">
          <div className="font-medium mb-2">Resultados</div>
          <Table head={['INÍCIO','FIM','VEÍCULO','DIST.','EVENTOS']} rows={[]}/>
          <Pager />
        </div>
        <div className="card">
          <div className="font-medium mb-2">Selecione um trajeto</div>
          <LeafletMap />
          <div className="flex items-center justify-between mt-2">
            <Button>Reproduzir</Button>
            <div className="text-sm text-sub">1x</div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
