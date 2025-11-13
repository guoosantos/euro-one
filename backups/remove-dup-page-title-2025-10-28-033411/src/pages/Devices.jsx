import React, { useState } from 'react'
import Layout from '../layout/Layout'
import PageHeader from '../ui/PageHeader'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Tabs from '../ui/Tabs'
import Field from '../ui/Field'
import { Table, Pager } from '../ui/Table'
import { Search } from 'lucide-react'

const pad = (n, size) => String(n).padStart(size, '0')
const seqCodes = (prefix, start, end) => {
  const p = String(prefix)
  const width = Math.max(String(start).length, String(end).length, 2)
  const out = []
  for(let i=start;i<=end;i++) out.push(p + pad(i, width))
  return out
}

export default function Devices(){
  const [openNew, setOpenNew] = useState(false)
  const [openBulk, setOpenBulk] = useState(false)
  const [tab, setTab] = useState('Dados')

  // form base
  const [f, setF] = useState({
    produto:'', imei:'', codigo:'', versao:'',
    statusServico:'Habilitado', statusFunc:'Funcionando', freq:'433 MHz',
    modoBloqueio:'Total', modoReset:'Automático', modoOficina:'Não',
    tempoPainel:'0', jammerMs:'0', dtProducao:'', obs:'',
    garantiaBase:'Instalação', garantiaDias:'365', garantiaInicio:'',
    destino:'Estoque', cliente:'', tecnico:''
  })

  // vinculações
  const [chipSel, setChipSel] = useState('')          // ICCID escolhido
  const [novoChipOpen, setNovoChipOpen] = useState(false)
  const [novoChip, setNovoChip] = useState({
    iccid:'', telefone:'', status:'Ativo', operadora:'', fornecedor:'',
    apn:'', apnUser:'', apnPass:'', obs:''
  })

  const [veicSel, setVeicSel] = useState('')          // veículo escolhido
  const [novoVeicOpen, setNovoVeicOpen] = useState(false)
  const [novoVeic, setNovoVeic] = useState({ placa:'', vin:'', marca:'', modelo:'' })

  // cadastro em massa
  const [bulk, setBulk] = useState({ prefixo:'25300', inicio:1, fim:100 })

  const on = (k)=> (e)=> setF(s=>({...s, [k]: e.target.value }))
  const onChip = (k)=> (e)=> setNovoChip(s=>({...s, [k]: e.target.value }))
  const onVeic = (k)=> (e)=> setNovoVeic(s=>({...s, [k]: e.target.value }))
  const onB = (k)=> (e)=> setBulk(s=>({...s, [k]: e.target.value }))

  const salvar = ()=>{
    const payload = { ...f, chip: chipSel || (novoChipOpen? novoChip : null), veiculo: veicSel || (novoVeicOpen? novoVeic : null) }
    console.log('SALVAR_UNICO', payload) // TODO: POST real
    setOpenNew(false)
  }

  const salvarMassa = ()=>{
    const codigos = seqCodes(bulk.prefixo, Number(bulk.inicio), Number(bulk.fim))
    const payload = codigos.map(code => ({ ...f, codigo: code }))
    console.log('SALVAR_EM_MASSA', payload.length, payload[0], '...', payload.at(-1))
    setOpenBulk(false)
  }

  return (
    <Layout title="Dispositivos">
      <PageHeader
        title="Equipamentos"
        right={
          <div className="flex gap-2">
            <Button onClick={()=>setOpenBulk(true)}>+ Cadastro em massa</Button>
            <Button onClick={()=>{setTab('Dados'); setOpenNew(true)}}>+ Novo equipamento</Button>
          </div>
        }
      />

      {/* filtros com rótulo embutido */}
      <Field label="Filtros">
        <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Input placeholder="Buscar dispositivo..." icon={Search}/>
          <Input placeholder="Buscar endereço..." />
          <Select><option>Instalados: Todos</option></Select>
          <Select><option>Alocação: Estoque Euro</option></Select>
          <Input placeholder="Cliente..." />
          <Input placeholder="Técnico..." />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button>Limpar filtros</Button>
          <Button>Atualizar</Button>
        </div>
      </Field>

      {/* tabela com rótulo */}
      <div className="mt-3">
        <Field label="Equipamentos">
          <Table head={['ID','Produto','IMEI','Versão','Serviço','Funcionalidade','Alocação','Endereço (último)','Garantia (até)','Status garantia','Atualizado em','Ações']} rows={[]}/>
          <Pager />
        </Field>
      </div>

      {/* MODAL: novo equipamento (com abas) */}
      <Modal open={openNew} onClose={()=>setOpenNew(false)} title="Novo equipamento" width="max-w-6xl">
        <Tabs tabs={['Dados','Vincular','Endereço','Histórico']} current={tab} onChange={setTab} />

        {tab==='Dados' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="grid gap-3">
              <Select value={f.produto} onChange={on('produto')}><option value="">Produto *</option><option>ES-JAMMER</option><option>EURO-BLOCK V2</option><option>GT06</option><option>SUNTECH</option></Select>
              <Input value={f.codigo} onChange={on('codigo')} placeholder="Código interno" />
              <Input value={f.statusFunc} onChange={on('statusFunc')} placeholder="Status de funcionalidade" />
              <Input value={f.modoReset} onChange={on('modoReset')} placeholder="Modo reset" />
              <Input value={f.tempoPainel} onChange={on('tempoPainel')} placeholder="Tempo de bloqueio painel (s)" />
            </div>
            <div className="grid gap-3">
              <Input value={f.imei} onChange={on('imei')} placeholder="IMEI * (ex.: 866512345678901)" />
              <Input value={f.versao} onChange={on('versao')} placeholder="Versão" />
              <Input value={f.statusServico} onChange={on('statusServico')} placeholder="Status de serviço" />
              <Input value={f.modoBloqueio} onChange={on('modoBloqueio')} placeholder="Modo bloqueio" />
              <Input value={f.jammerMs} onChange={on('jammerMs')} placeholder="Detecção por Jammer (ms)" />
            </div>
            <div className="grid gap-3">
              <Input value={f.freq} onChange={on('freq')} placeholder="Frequência" />
              <Input value={f.modoOficina} onChange={on('modoOficina')} placeholder="Modo oficina" />
              <Input value={f.dtProducao} onChange={on('dtProducao')} placeholder="Data de produção (dd/mm/aaaa)" />
              <textarea value={f.obs} onChange={(e)=>setF(s=>({...s,obs:e.target.value}))} rows={4} className="w-full bg-card/60 border border-stroke rounded-xl px-3 py-2" placeholder="Observação"/>
            </div>
            <div className="grid gap-3">
              <Select value={f.garantiaBase} onChange={on('garantiaBase')}>
                <option value="Instalação">Base da garantia: Instalação</option>
                <option value="Venda">Base da garantia: Venda</option>
              </Select>
              <Input value={f.garantiaDias} onChange={on('garantiaDias')} placeholder="Dias de garantia" />
              <Input value={f.garantiaInicio} onChange={on('garantiaInicio')} placeholder="Início da garantia (dd/mm/aaaa)" />
              <Input value={f.destino} onChange={on('destino')} placeholder="Destino (Estoque/Cliente/Técnico)" />
              <Input value={f.cliente} onChange={on('cliente')} placeholder="Cliente (opcional)" />
              <Input value={f.tecnico} onChange={on('tecnico')} placeholder="Técnico (opcional)" />
            </div>
          </div>
        )}

        {tab==='Vincular' && (
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Chip">
              <div className="grid md:grid-cols-2 gap-3">
                <Input placeholder="Buscar ICCID/Telefone" onChange={(e)=>setChipSel(e.target.value)} />
                <Button onClick={()=>setNovoChipOpen(v=>!v)}>{novoChipOpen?'Cancelar novo chip':'Cadastrar novo chip'}</Button>
              </div>
              {novoChipOpen && (
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <Input placeholder="ICCID *" value={novoChip.iccid} onChange={onChip('iccid')}/>
                  <Input placeholder="Telefone *" value={novoChip.telefone} onChange={onChip('telefone')}/>
                  <Input placeholder="Status *" value={novoChip.status} onChange={onChip('status')}/>
                  <Input placeholder="Operadora *" value={novoChip.operadora} onChange={onChip('operadora')}/>
                  <Input placeholder="Fornecedor" value={novoChip.fornecedor} onChange={onChip('fornecedor')}/>
                  <Input placeholder="APN" value={novoChip.apn} onChange={onChip('apn')}/>
                  <Input placeholder="APN Usuário" value={novoChip.apnUser} onChange={onChip('apnUser')}/>
                  <Input placeholder="APN Senha" value={novoChip.apnPass} onChange={onChip('apnPass')}/>
                  <textarea placeholder="Observações" value={novoChip.obs} onChange={onChip('obs')} className="w-full bg-card/60 border border-stroke rounded-xl px-3 py-2 md:col-span-2" rows={3}/>
                </div>
              )}
            </Field>

            <Field label="Veículo">
              <div className="grid md:grid-cols-2 gap-3">
                <Input placeholder="Buscar por placa/VIN" onChange={(e)=>setVeicSel(e.target.value)} />
                <Button onClick={()=>setNovoVeicOpen(v=>!v)}>{novoVeicOpen?'Cancelar novo veículo':'Cadastrar novo veículo'}</Button>
              </div>
              {novoVeicOpen && (
                <div className="grid md:grid-cols-2 gap-3 mt-3">
                  <Input placeholder="Placa *" value={novoVeic.placa} onChange={onVeic('placa')}/>
                  <Input placeholder="VIN" value={novoVeic.vin} onChange={onVeic('vin')}/>
                  <Input placeholder="Marca" value={novoVeic.marca} onChange={onVeic('marca')}/>
                  <Input placeholder="Modelo" value={novoVeic.modelo} onChange={onVeic('modelo')}/>
                </div>
              )}
            </Field>
          </div>
        )}

        {tab==='Endereço' && <div className="legend-card"><div className="legend">Endereço</div><div className="mt-2 text-sm muted">Plugaremos mapa/geo aqui.</div></div>}
        {tab==='Histórico' && <div className="legend-card"><div className="legend">Histórico</div><div className="mt-2 text-sm muted">Logs e alterações aparecerão aqui.</div></div>}

        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={()=>setOpenNew(false)}>Cancelar</Button>
          <Button onClick={salvar}>Salvar</Button>
        </div>
      </Modal>

      {/* MODAL: cadastro em massa */}
      <Modal open={openBulk} onClose={()=>setOpenBulk(false)} title="Cadastro em massa" width="max-w-3xl">
        <div className="grid md:grid-cols-3 gap-3">
          <Input value={bulk.prefixo} onChange={onB('prefixo')} placeholder="Prefixo numérico (ex.: 25300)"/>
          <Input type="number" value={bulk.inicio} onChange={onB('inicio')} placeholder="Início (ex.: 1)"/>
          <Input type="number" value={bulk.fim} onChange={onB('fim')} placeholder="Fim (ex.: 100)"/>
        </div>
        <div className="text-sm muted mt-2">
          Ex.: {bulk.prefixo}-{bulk.inicio}..{bulk.fim} ➜ {seqCodes(bulk.prefixo, Number(bulk.inicio), Number(bulk.fim)).slice(0,3).join(', ')}…
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={()=>setOpenBulk(false)}>Cancelar</Button>
          <Button onClick={salvarMassa}>Cadastrar</Button>
        </div>
      </Modal>
    </Layout>
  )
}
