import React from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { Table, Pager } from '../ui/Table'
import { Search } from 'lucide-react'
import { NavLink, Outlet, Routes, Route } from 'react-router-dom'

function Shell({children}){
  return (
    <Layout title="Veículos">
      <PageHeader title="Veículos Euro" right={<div className="flex gap-2"><Button>+ Novo veículo</Button></div>} />
      <div className="card">
        <Input placeholder="Buscar (placa, VIN, marca, modelo, proprietário, grupo)" icon={Search}/>
      </div>
      {children}
    </Layout>
  )
}

function List(){
  return (
    <div className="card mt-3">
      <Table head={['PLACA','VEÍCULO','PROPRIETÁRIO','GRUPO','EQUIPAMENTO','STATUS','ATUALIZADO EM','AÇÕES']} rows={[]}/>
      <Pager />
    </div>
  )
}

export default function Vehicles(){
  return <Shell><List/></Shell>
}
