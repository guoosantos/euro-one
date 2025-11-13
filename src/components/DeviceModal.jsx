import React, {useEffect, useMemo, useState} from 'react'
import LInput from '../ui/LInput'
import LSelect from '../ui/LSelect'
import LTextArea from '../ui/LTextArea'

export default function DeviceModal({ open, initialData={}, onClose, onSave }) {
  const [tab, setTab] = useState('dados')
  const [f, setF] = useState(()=>({
    produto:'', imei:'', codigo:'', versao:'', servico:'Habilitado',
    func:'Funcionando', reset:'Automático', bloqueio:'Total',
    tempoPainel:'0', jammerMs:'0', freq:'433 MHz', oficina:'Não',
    baseGarantia:'Instalação', diasGarantia:'365', inicioGarantia:'', destino:'Estoque',
    cliente:'', tecnico:'', obs:'', dataProducao:''
  }))
  useEffect(()=>{ setF(prev=>({...prev, ...initialData})) },[initialData])
  useEffect(()=>{
    if (!open) return
    const onKey = (e)=>{ if(e.key==='Escape'){ onClose?.() } if(e.key==='Enter' && (e.metaKey||e.ctrlKey)){ handleSave() } }
    window.addEventListener('keydown', onKey)
    return ()=>window.removeEventListener('keydown', onKey)
  },[open])
  const set = (k)=>(e)=> setF(s=>({...s,[k]: e?.target ? e.target.value : e}))
  const tabs = useMemo(()=>[
    {id:'dados', label:'Dados'},
    {id:'vincular', label:'Vincular'},
    {id:'endereco', label:'Endereço'},
    {id:'historico', label:'Histórico'},
  ],[])
  async function handleSave(){
    const payload = {...f}
    await onSave?.(payload)
    onClose?.()
  }
  if(!open) return null
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="title">Novo equipamento</div>
        <div className="flex gap-2 mb-2">
          {tabs.map(t=>(
            <button key={t.id} className={`tab-btn ${tab===t.id?'active':''}`}
              onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
          <div style={{flex:1}} />
          <button className="btn danger" onClick={onClose}>Fechar</button>
        </div>
        {tab==='dados' && (
          <div className="grid gap-3 md:grid-cols-2">
            <LSelect label="Produto *" value={f.produto} onChange={set('produto')}>
              <option value="">Selecione…</option>
              <option>ES-JAMMER</option><option>GT06</option><option>Suntech</option>
            </LSelect>
            <LInput  label="IMEI * (ex.: 866512345678901)" value={f.imei} onChange={set('imei')} />
            <LInput  label="Código interno" value={f.codigo} onChange={set('codigo')} />
            <LInput  label="Versão" value={f.versao} onChange={set('versao')} />
            <LInput  label="Status de funcionalidade" value={f.func} onChange={set('func')} />
            <LInput  label="Status de serviço" value={f.servico} onChange={set('servico')} />
            <LInput  label="Modo reset" value={f.reset} onChange={set('reset')} />
            <LInput  label="Modo bloqueio" value={f.bloqueio} onChange={set('bloqueio')} />
            <LInput  label="Tempo de bloqueio painel (s)" value={f.tempoPainel} onChange={set('tempoPainel')} />
            <LInput  label="Detecção por Jammer (ms)"  value={f.jammerMs} onChange={set('jammerMs')} />
            <LInput  label="Frequência" value={f.freq} onChange={set('freq')} />
            <LInput  label="Modo oficina" value={f.oficina} onChange={set('oficina')} />
            <LInput  label="Data de produção (dd/mm/aaaa)" value={f.dataProducao} onChange={set('dataProducao')} />
            <LSelect label="Base da garantia" value={f.baseGarantia} onChange={set('baseGarantia')}>
              <option>Instalação</option><option>Venda</option>
            </LSelect>
            <LInput  label="Dias de garantia" value={f.diasGarantia} onChange={set('diasGarantia')} />
            <LInput  label="Início da garantia (dd/mm/aaaa)" value={f.inicioGarantia} onChange={set('inicioGarantia')} />
            <LInput  label="Destino (Estoque/Cliente/Técnico)" value={f.destino} onChange={set('destino')} />
            <LInput  label="Cliente (opcional)" value={f.cliente} onChange={set('cliente')} />
            <LInput  label="Técnico (opcional)" value={f.tecnico} onChange={set('tecnico')} />
            <div className="md:col-span-2"><LTextArea label="Observação" value={f.obs} onChange={set('obs')} /></div>
          </div>
        )}
        {tab==='vincular' && (
          <div className="grid gap-3 md:grid-cols-2">
            <LInput label="Chip (ICCID ou telefone)" value={f.chip} onChange={set('chip')} />
            <LInput label="Veículo (placa/ID)" value={f.veiculo} onChange={set('veiculo')} />
          </div>
        )}
        {tab==='endereco' && (
          <div className="grid gap-3 md:grid-cols-2">
            <LInput label="Endereço (rua, número, cidade…)" value={f.endereco} onChange={set('endereco')} />
            <LInput label="Complemento" value={f.comp} onChange={set('comp')} />
            <LInput label="Latitude" value={f.lat} onChange={set('lat')} />
            <LInput label="Longitude" value={f.lng} onChange={set('lng')} />
          </div>
        )}
        {tab==='historico' && (
          <div className="text-sm text-gray-300/80">Sem histórico por enquanto.</div>
        )}
        <div className="footer">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={handleSave}>Salvar</button>
        </div>
      </div>
    </div>
  )
}
