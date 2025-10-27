import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Table, Pager } from '../ui/Table'
import LInput from '../ui/LInput'

export default function Products(){
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ nome:'', fabricante:'', protocolo:'', tipo:'' })
  const on = k => e => setF(s=>({...s,[k]:e.target.value}))
  const salvar = ()=>{ console.log('PRODUTO_SAVE', f); setOpen(false) }

  return (
    <Layout title="Produtos">
      <PageHeader title="Produtos (modelos)" right={<Button onClick={()=>setOpen(true)}>+ Novo modelo</Button>} />
      <div className="card">
        <div className="font-medium mb-2">Modelos cadastrados</div>
        <Table head={['Nome','Fabricante','Protocolo','Tipo','Ações']} rows={[]}/>
        <Pager />
      </div>

      <Modal open={open} onClose={()=>setOpen(false)} title="Novo modelo" width="max-w-3xl">
        <div className="grid md:grid-cols-2 gap-3">
          <LInput label="Nome * (ex.: ES-JAMMER)" value={f.nome} onChange={on('nome')}/>
          <LInput label="Fabricante (ex.: Euro)" value={f.fabricante} onChange={on('fabricante')}/>
          <LInput label="Protocolo (GT06, Suntech, Euro)" value={f.protocolo} onChange={on('protocolo')}/>
          <LInput label="Tipo (rastreador/câmera/módulo)" value={f.tipo} onChange={on('tipo')}/>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={()=>setOpen(false)}>Cancelar</Button>
          <Button onClick={salvar}>Salvar</Button>
        </div>
      </Modal>
    </Layout>
  )
}
