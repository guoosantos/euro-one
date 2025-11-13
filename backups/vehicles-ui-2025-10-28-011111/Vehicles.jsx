import React, { useState } from 'react';
import Layout from '../layout/Layout';
import PageHeader from '../ui/PageHeader';
import Input from '../ui/Input';
import Field from '../ui/Field';
import { Table, Pager } from '../ui/Table';
import Button from '../ui/Button';
import VehicleModal from '../components/VehicleModal';

export default function Vehicles(){
  const [open, setOpen] = useState(false);

  return (
    <Layout title="Veículos">
      <PageHeader
        title="Veículos Euro"
        right={<Button onClick={()=>setOpen(true)}>+ Novo veículo</Button>}
      />

      <Field label="Busca">
        <Input placeholder="Buscar (placa, VIN, marca, modelo, proprietário, grupo)" />
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table head={['PLACA','VEÍCULO','PROPRIETÁRIO','GRUPO','EQUIPAMENTO','STATUS','ATUALIZADO EM','AÇÕES']} rows={[]} />
          <Pager />
        </Field>
      </div>

      <VehicleModal open={open} onClose={()=>setOpen(false)} onSave={(v)=>console.log('VEHICLE_SAVE', v)} />
    </Layout>
  );
}
