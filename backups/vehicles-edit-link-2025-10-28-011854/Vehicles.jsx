import React, { useState } from 'react';
import Layout from '../layout/Layout';
import PageHeader from '../ui/PageHeader';
import Field from '../ui/Field';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Table, Pager } from '../ui/Table';
import VehicleModal from '../components/VehicleModal';

export default function Vehicles(){
  const [open, setOpen] = useState(false);

  const salvar = (dados)=>{
    console.log('VEICULO_SALVAR', dados); // TODO: integrar API
    setOpen(false);
  };

  return (
    <Layout title="Veículos">
      <PageHeader
        title="Veículos Euro"
        right={<Button onClick={()=>setOpen(true)}>+ Novo veículo</Button>}
      />

      <Field label="Buscar">
        <Input placeholder="Buscar (placa, VIN, marca, modelo, proprietário, grupo)"/>
      </Field>

      <div className="mt-3">
        <Field label="Resultados">
          <Table head={['PLACA','VEÍCULO','PROPRIETÁRIO','GRUPO','EQUIPAMENTO','STATUS','ATUALIZADO EM','AÇÕES']} rows={[]}/>
          <Pager />
        </Field>
      </div>

      <VehicleModal open={open} onClose={()=>setOpen(false)} onSave={salvar}/>
    </Layout>
  );
}
