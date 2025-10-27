import LTextArea from '../ui/LTextArea';
import LSelect from '../ui/LSelect';
import LInput from '../ui/LInput';
import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Field from '../ui/Field'
import { Table, Pager } from '../ui/Table'
import { Search } from 'lucide-react'

export default function Chips(){
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ iccid:'', telefone:'', status:'Ativo', operadora:'', fornecedor:'', apn:'', apnUser:'', apnPass:'', obs:'' })
  const on = k => e => setF(s=>({...s, [k]: e.target.value }))
  const salvar = ()=>{ console.log('CHIP_SAVE', f); setOpen(false) }

  return (
    <Layout title="Chips">
      <PageHeader title="Chips" right={<Button onClick={()=>setOpen(true)}>+ Novo chip</Button>} />
      <Field label="Filtros">
        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Input placeholder="Buscar ICCID/Telefone" icon={Search}/>
          <Select><option>Status: Todos</option><option>Disponível</option><option>Vinculado</option></Select>
          <Select><option>Operadora: Todas</option><option>Vivo</option><option>Claro</option><option>Tim</option><option>Oi</option></Select>
        </div>
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table head={['ICCID','Telefone','Operadora','Status','Equipamento','Ações']} rows={[]}/>
          <Pager />
        </Field>
      </div>

      <Modal open={open} onClose={()=>setOpen(false)} title="Novo chip" width="max-w-3xl">
        <div className="grid md:grid-cols-2 gap-3">
          <Input placeholder="ICCID *" value={f.iccid} onChange={on('iccid')}/>
          <Input placeholder="Telefone *" value={f.telefone} onChange={on('telefone')}/>
          <Input placeholder="Status *" value={f.status} onChange={on('status')}/>
          <Input placeholder="Operadora *" value={f.operadora} onChange={on('operadora')}/>
          <Input placeholder="Fornecedor" value={f.fornecedor} onChange={on('fornecedor')}/>
          <Input placeholder="APN" value={f.apn} onChange={on('apn')}/>
          <Input placeholder="APN Usuário" value={f.apnUser} onChange={on('apnUser')}/>
          <Input placeholder="APN Senha" value={f.apnPass} onChange={on('apnPass')}/>
          <textarea placeholder="Observações" value={f.obs} onChange={on('obs')} className="w-full bg-card/60 border border-stroke rounded-xl px-3 py-2 md:col-span-2" rows={3}/>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={()=>setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar}>Salvar</Button>
        </div>
      </Modal>
    </Layout>
  )
}
