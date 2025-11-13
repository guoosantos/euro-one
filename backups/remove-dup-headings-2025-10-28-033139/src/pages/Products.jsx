import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Button from '../ui/Button'
import Field from '../ui/Field'
import { Table, Pager } from '../ui/Table'

export default function Products(){
  const [f, setF] = useState({ nome:'', fabricante:'', protocolo:'', tipo:'' })
  const on = k => e => setF(s=>({...s,[k]:e.target.value}))
  const salvar = ()=>{ console.log('PRODUTO_SAVE', f) }

  return (
    <Layout title="Produtos">
      <PageHeader title="Produtos (modelos)" />
      <div className="grid gap-3">
        <Field label="Novo modelo">
          <div className="grid md:grid-cols-4 gap-3">
            <Input placeholder="Nome * (ex.: ES-JAMMER)" value={f.nome} onChange={on('nome')}/>
            <Input placeholder="Fabricante (ex.: Euro)" value={f.fabricante} onChange={on('fabricante')}/>
            <Input placeholder="Protocolo (GT06, Suntech, Euro)" value={f.protocolo} onChange={on('protocolo')}/>
            <Input placeholder="Tipo (rastreador/câmera/módulo)" value={f.tipo} onChange={on('tipo')}/>
          </div>
          <div className="mt-3"><Button onClick={salvar}>Salvar modelo</Button></div>
        </Field>

        <Field label="Modelos cadastrados">
          <Table head={['Nome','Fabricante','Protocolo','Tipo','Ações']} rows={[]}/>
          <Pager />
        </Field>
      </div>
    </Layout>
  )
}
