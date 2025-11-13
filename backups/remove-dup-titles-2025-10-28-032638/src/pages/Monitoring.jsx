import React from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import KPI from '../ui/KPI'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { Table, Pager } from '../ui/Table'
import { Search, Camera, Activity, AlertTriangle, Power } from 'lucide-react'

export default function Monitoring(){
  return (
    <Layout title="Monitoramento">
      <PageHeader title="Monitoramento" subtitle="Ordenado por última transmissão. Atualização a cada 30s."
        right={<div className="flex items-center gap-2"><Select><option>A cada 30s</option></Select><Button>Atualizar</Button></div>}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KPI tone="green" title="Online" value="0" icon={<Activity size={18}/>}/>
        <KPI tone="yellow" title="Em alerta" value="0" icon={<AlertTriangle size={18}/>}/>
        <KPI tone="blue" title="Câmeras OK" value="0" icon={<Camera size={18}/>}/>
        <KPI tone="red" title="Sem sinal (+1h)" value="0" icon={<Power size={18}/>}/>
      </div>

      <div className="card mt-3">
        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Input placeholder="Buscar (veículo, placa, motorista)" icon={Search}/>
          <Select><option>Status: Todos</option></Select>
          <Select><option>Grupo: Todos</option></Select>
          <Select><option>Período: Intervalo</option></Select>
          <Input type="date" />
          <Input type="date" />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button>Limpar filtros</Button>
          <Button>Atualizar</Button>
        </div>
      </div>

      <div className="card mt-3">
        <Table head={['VEÍCULO','PLACA','STATUS','ÚLTIMA TRANSMISSÃO','ENDEREÇO','VEL (KM/H)','IGNAÇÃO','BATERIA','RSSI','SATÉLITES','ALERTAS (GRAU)','AÇÕES']} rows={[]}/>
        <Pager />
      </div>
    </Layout>
  )
}
