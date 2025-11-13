import DeviceModal from "../components/DeviceModal";
import SelectPill from "../ui/SelectPill";
import SearchInput from "../ui/SearchInput";
import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Tabs from '../ui/Tabs'
import Field from '../ui/Field'
import { Table, Pager } from '../ui/Table'
import LInput from '../ui/LInput'
import LSelect from '../ui/LSelect'
import LTextArea from '../ui/LTextArea'

const pad = (n, size) => String(n).padStart(size, '0')
const seqCodes = (prefix, start, end) => {
  const p = String(prefix)
  const width = Math.max(String(start).length, String(end).length, 2)
  const out = []; for(let i=start;i<=end;i++) out.push(p + pad(i, width)); return out
}

export default function Devices(){
  const [showNew, setShowNew] = useState(false);

  const [openNew, setOpenNew] = useState(false)
  const [openBulk, setOpenBulk] = useState(false)
  const [tab, setTab] = useState('Dados')

  const [f, setF] = useState({
    produto:'', imei:'', codigo:'', versao:'',
    statusServico:'Habilitado', statusFunc:'Funcionando', freq:'433 MHz',
    modoBloqueio:'Total', modoReset:'Automático', modoOficina:'Não',
    tempoPainel:'0', jammerMs:'0', dtProducao:'', obs:'',
    garantiaBase:'Instalação', garantiaDias:'365', garantiaInicio:'',
    destino:'Estoque', cliente:'', tecnico:''
  })
  const [chipSel, setChipSel] = useState('')
  const [novoChipOpen, setNovoChipOpen] = useState(false)
  const [novoChip, setNovoChip] = useState({ iccid:'', telefone:'', status:'Ativo', operadora:'', fornecedor:'', apn:'', apnUser:'', apnPass:'', obs:'' })
  const [veicSel, setVeicSel] = useState('')
  const [novoVeicOpen, setNovoVeicOpen] = useState(false)
  const [novoVeic, setNovoVeic] = useState({ placa:'', vin:'', marca:'', modelo:'' })
  const [bulk, setBulk] = useState({ prefixo:'25300', inicio:1, fim:100 })

  const on = k => e => setF(s=>({...s,[k]:e.target.value}))
  const onChip = k => e => setNovoChip(s=>({...s,[k]:e.target.value}))
  const onVeic = k => e => setNovoVeic(s=>({...s,[k]:e.target.value}))
  const onB = k => e => setBulk(s=>({...s,[k]:e.target.value}))

  const salvar = ()=>{
  const payload = {
    f,
    chipSel,
    chipNovo: (novoChipOpen ? novoChip : null),
    veicSel,
    veicNovo: (novoVeicOpen ? novoVeic : null)
  };
  console.log('SALVAR_UNICO', payload);
  setOpenNew(false)
}
  const salvarMassa = ()=>{ const codigos=seqCodes(bulk.prefixo,+bulk.inicio,+bulk.fim); console.log('SALVAR_EM_MASSA',codigos.length); setOpenBulk(false) }

  return (
    <Layout title="Dispositivos">
      <PageHeader title="Equipamentos"
        right={<div className="flex gap-2"><Button onClick={()=>setOpenBulk(true)}>+ Cadastro em massa</Button><Button onClick={()=>{setTab('Dados'); setOpenNew(true)}}>+ Novo equipamento</Button></div>}
      />

      <div className="filters">
<Field label="Filtros">
        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          <LInput label="Buscar dispositivo" placeholder="IMEI, código, cliente, técnico"/>
          <LInput label="Buscar endereço" placeholder="Rua, cidade"/>
          <LSelect label="Instalados"><option>Todos</option><option>Sim</option><option>Não</option></LSelect>
          <LSelect label="Alocação"><option>Estoque Euro</option><option>Cliente</option><option>Técnico</option></LSelect>
          <LInput label="Cliente"/><LInput label="Técnico"/>
        </div>
      </Field>

      
</div><div className="mt-3">
        <Field label="Equipamentos">
          <Table head={['ID','Produto','IMEI','Versão','Serviço','Funcionalidade','Alocação','Endereço (último)','Garantia (até)','Status garantia','Atualizado em','Ações']} rows={[]}/>
          <Pager />
        </Field>
      </div>

      <Modal open={openNew} onClose={()=>setOpenNew(false)} title="Novo equipamento" width="max-w-6xl">
        <Tabs tabs={['Dados','Vincular','Endereço','Histórico']} current={tab} onChange={setTab}/>
        {tab==='Dados' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="grid gap-3">
              <LSelect label="Produto *" value={f.produto} onChange={on('produto')}>
                <option value="">Selecione…</option><option>ES-JAMMER</option><option>EURO-BLOCK V2</option><option>GT06</option><option>SUNTECH</option>
              </LSelect>
              <LInput label="Código interno" value={f.codigo} onChange={on('codigo')}/>
              <LInput label="Status de funcionalidade" value={f.statusFunc} onChange={on('statusFunc')}/>
              <LInput label="Modo reset" value={f.modoReset} onChange={on('modoReset')}/>
              <LInput label="Tempo de bloqueio painel (s)" value={f.tempoPainel} onChange={on('tempoPainel')}/>
            </div>
            <div className="grid gap-3">
              <LInput label="IMEI * (ex.: 866512345678901)" value={f.imei} onChange={on('imei')}/>
              <LInput label="Versão" value={f.versao} onChange={on('versao')}/>
              <LInput label="Status de serviço" value={f.statusServico} onChange={on('statusServico')}/>
              <LInput label="Modo bloqueio" value={f.modoBloqueio} onChange={on('modoBloqueio')}/>
              <LInput label="Detecção por Jammer (ms)" value={f.jammerMs} onChange={on('jammerMs')}/>
            </div>
            <div className="grid gap-3">
              <LInput label="Frequência" value={f.freq} onChange={on('freq')}/>
              <LInput label="Modo oficina" value={f.modoOficina} onChange={on('modoOficina')}/>
              <LInput label="Data de produção (dd/mm/aaaa)" value={f.dtProducao} onChange={on('dtProducao')}/>
              <LTextArea label="Observação" value={f.obs} onChange={e=>setF(s=>({...s,obs:e.target.value}))}/>
            </div>
            <div className="grid gap-3">
              <LSelect label="Base da garantia" value={f.garantiaBase} onChange={on('garantiaBase')}>
                <option value="Instalação">Instalação</option><option value="Venda">Venda</option>
              </LSelect>
              <LInput label="Dias de garantia" value={f.garantiaDias} onChange={on('garantiaDias')}/>
              <LInput label="Início da garantia (dd/mm/aaaa)" value={f.garantiaInicio} onChange={on('garantiaInicio')}/>
              <LInput label="Destino (Estoque/Cliente/Técnico)" value={f.destino} onChange={on('destino')}/>
              <LInput label="Cliente (opcional)" value={f.cliente} onChange={on('cliente')}/>
              <LInput label="Técnico (opcional)" value={f.tecnico} onChange={on('tecnico')}/>
            </div>
          </div>
        )}
        {tab==='Vincular' && (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Chip">
              <div className="grid md:grid-cols-2 gap-3">
                <LInput label="Buscar ICCID/Telefone" onChange={e=>setChipSel(e.target.value)}/>
                <Button onClick={()=>setNovoChipOpen(v=>!v)}>{novoChipOpen?'Cancelar novo chip':'Cadastrar novo chip'}</Button>
              </div>
              {novoChipOpen && (
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <LInput label="ICCID *" value={novoChip.iccid} onChange={onChip('iccid')}/>
                  <LInput label="Telefone *" value={novoChip.telefone} onChange={onChip('telefone')}/>
                  <LInput label="Status *" value={novoChip.status} onChange={onChip('status')}/>
                  <LInput label="Operadora *" value={novoChip.operadora} onChange={onChip('operadora')}/>
                  <LInput label="Fornecedor" value={novoChip.fornecedor} onChange={onChip('fornecedor')}/>
                  <LInput label="APN" value={novoChip.apn} onChange={onChip('apn')}/>
                  <LInput label="APN Usuário" value={novoChip.apnUser} onChange={onChip('apnUser')}/>
                  <LInput label="APN Senha" value={novoChip.apnPass} onChange={onChip('apnPass')}/>
                  <LTextArea label="Observações" value={novoChip.obs} onChange={onChip('obs')} className="md:col-span-2"/>
                </div>
              )}
            </Field>
            <Field label="Veículo">
              <div className="grid md:grid-cols-2 gap-3">
                <LInput label="Buscar por placa/VIN" onChange={e=>setVeicSel(e.target.value)}/>
                <Button onClick={()=>setNovoVeicOpen(v=>!v)}>{novoVeicOpen?'Cancelar novo veículo':'Cadastrar novo veículo'}</Button>
              </div>
              {novoVeicOpen && (
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <LInput label="Placa *" value={novoVeic.placa} onChange={onVeic('placa')}/>
                  <LInput label="VIN" value={novoVeic.vin} onChange={onVeic('vin')}/>
                  <LInput label="Marca" value={novoVeic.marca} onChange={onVeic('marca')}/>
                  <LInput label="Modelo" value={novoVeic.modelo} onChange={onVeic('modelo')}/>
                </div>
              )}
            </Field>
          </div>
        )}
        {tab==='Endereço' && <div className="card">Plugar mapa/geo aqui.</div>}
        {tab==='Histórico' && <div className="card">Logs e alterações…</div>}
        <div className="mt-4 flex justify-end gap-2"><Button onClick={()=>setOpenNew(false)}>Cancelar</Button><Button onClick={salvar}>Salvar</Button></div>
      </Modal>

      <Modal open={openBulk} onClose={()=>setOpenBulk(false)} title="Cadastro em massa" width="max-w-3xl">
        <div className="grid md:grid-cols-3 gap-3">
          <LInput label="Prefixo numérico" value={bulk.prefixo} onChange={onB('prefixo')}/>
          <LInput label="Início" type="number" value={bulk.inicio} onChange={onB('inicio')}/>
          <LInput label="Fim" type="number" value={bulk.fim} onChange={onB('fim')}/>
        </div>
        <div className="text-sm muted mt-2">Ex.: {bulk.prefixo}-{bulk.inicio}..{bulk.fim} ➜ {seqCodes(bulk.prefixo,+bulk.inicio,+bulk.fim).slice(0,3).join(', ')}…</div>
        <div className="mt-4 flex justify-end gap-2"><Button onClick={()=>setOpenBulk(false)}>Cancelar</Button><Button onClick={salvarMassa}>Cadastrar</Button></div>
      </Modal>
      <DeviceModal open={showNew} onClose={()=>setShowNew(false)} onSave={(p)=>{console.log("SALVAR EQUIPAMENTO",p)}} />
</Layout>
  )
}
