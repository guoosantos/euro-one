import CommBuckets from "../components/CommBuckets";
import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Button from '../ui/Button'
import Field from '../ui/Field'
import { Table, Pager } from '../ui/Table'
import VehicleModal from '../components/VehicleModal'
import { Search } from 'lucide-react'

export default function Vehicles(){
  // Demo/local state (substituir por API real depois)
  const [rows, setRows] = useState([])  // cada item: {id, placa, modelo, proprietario, grupo, equipamento, status, updatedAt}
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('new') // 'new' | 'edit'
  const [current, setCurrent] = useState(null) // registro atual p/ edição
  const [linkMap, setLinkMap] = useState({})   // vehicleId -> imei

  const abrirNovo = () => { setMode('new'); setCurrent(null); setOpen(true) }
  const abrirEditar = (row) => { setMode('edit'); setCurrent(row); setOpen(true) }

  const handleSave = (veh) => {
    if (mode==='new') {
      const id = Date.now()
      setRows(r=>[...r,{ id, placa:veh.placa, modelo:veh.modelo, proprietario:veh.cliente, grupo:veh.grupo, equipamento: linkMap[id]||'', status:'Ativo', updatedAt:new Date().toISOString() }])
    } else if (current) {
      setRows(r=>r.map(x=> x.id===current.id ? { ...x, placa:veh.placa, modelo:veh.modelo, proprietario:veh.cliente, grupo:veh.grupo, updatedAt:new Date().toISOString() } : x))
    }
  }

  const handleLink = (vehicleIdOrNull, imei) => {
    // se for novo, guardamos num "buffer" e aplicamos após salvar (vehicleId real)
    if (!vehicleIdOrNull) {
      // buffer (usa -1 como chave temporária)
      setLinkMap(m=>({ ...m, '-pending': imei }))
      return
    }
    setLinkMap(m=>({ ...m, [vehicleIdOrNull]: imei }))
    setRows(r=>r.map(x=> x.id===vehicleIdOrNull ? { ...x, equipamento: imei } : x))
  }

  // Se houve vinculação antes de salvar o "novo", aplica ao id recém criado
  React.useEffect(()=>{
    if (!open && mode==='new' && linkMap['-pending']) {
      const last = rows[rows.length-1]
      if (last?.id) {
        setLinkMap(m=>{
          const { ['-pending']:pending, ...rest } = m
          return { ...rest, [last.id]: pending }
        })
        setRows(r=>r.map((x,i)=> i===r.length-1 ? { ...x, equipamento: linkMap['-pending'] } : x))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const filtered = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()))

  const head = ['PLACA','VEÍCULO','PROPRIETÁRIO','GRUPO','EQUIPAMENTO','STATUS','ATUALIZADO EM','AÇÕES']
  const body = filtered.map(r => ([
    r.placa, r.modelo, r.proprietario || '-', r.grupo || '-', r.equipamento || '-', r.status || '-', new Date(r.updatedAt||Date.now()).toLocaleString(),
    <div className="flex gap-2 justify-end" key={'act'+r.id}>
      <Button onClick={()=>abrirEditar(r)}>Editar</Button>
    </div>
  ]))

  return (
    
      <CommBuckets />
<Layout title="Veículos">
      <PageHeader
        title="Veículos Euro"
        right={<Button onClick={abrirNovo}>+ Novo veículo</Button>}
      />

      <Field label="Busca">
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          <Input placeholder="Buscar (placa, VIN, marca, modelo, proprietário, grupo)" icon={Search} value={q} onChange={e=>setQ(e.target.value)} />
        </div>
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table head={head} rows={body}/>
          <Pager />
        </Field>
      </div>

      <VehicleModal
        open={open}
        mode={mode}
        initialData={current}
        onClose={()=>setOpen(false)}
        onSave={handleSave}
        onLinkDevice={handleLink}
        linkedDevice={current ? linkMap[current.id] || '' : (linkMap['-pending'] || '')}
      />
    </Layout>
  )
}
