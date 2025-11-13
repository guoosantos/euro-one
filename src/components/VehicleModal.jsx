import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import LInput from '../ui/LInput';
import LSelect from '../ui/LSelect';
import LTextArea from '../ui/LTextArea';
import Tabs from '../ui/Tabs';

export default function VehicleModal({
  open,
  mode = 'new',              // 'new' | 'edit'
  initialData = null,        // dados do veículo para edição
  onClose,
  onSave,                    // (veiculo) => void
  onLinkDevice,              // (veiculoId|null, imei) => void
  linkedDevice               // IMEI atualmente vinculado (string | null)
}) {
  const [tab, setTab] = useState('Dados');

  const blank = useMemo(()=>({
    cliente:'', tipo:'', placa:'', identificador:'',
    grupo:'', classificacao:'',
    modelo:'', marca:'', chassi:'', renavam:'', cor:'',
    anoModelo:'', anoFabricacao:'', codigoFipe:'', valorFipe:'',
    zeroKm:'Não', observacoes:''
  }),[]);

  const [f, setF] = useState(blank);
  const on = k => e => setF(s=>({...s,[k]:e.target.value}));

  // Vinculação
  const [imeiBusca, setImeiBusca] = useState('');
  const [imeiSelecionado, setImeiSelecionado] = useState('');
  const [vinculoAtual, setVinculoAtual] = useState(linkedDevice || '');

  useEffect(()=>{
    if (open) {
      setTab('Dados');
      setF(initialData ? { ...blank, ...initialData } : blank);
      setVinculoAtual(linkedDevice || '');
      setImeiBusca('');
      setImeiSelecionado('');
    }
  }, [open, initialData, linkedDevice, blank]);

  const salvar = () => {
    const obrig = [['cliente','Cliente'],['tipo','Tipo'],['placa','Placa'],['modelo','Modelo']];
    const falt = obrig.filter(([k]) => !String(f[k]||'').trim()).map(([,l])=>l);
    if (falt.length) { alert('Preencha: ' + falt.join(', ')); return; }
    onSave?.(f);
    onClose?.();
  };

  const vincular = () => {
    const imei = (imeiSelecionado || imeiBusca || '').trim();
    if (!imei) { alert('Informe/seleciona um IMEI'); return; }
    onLinkDevice?.(initialData?.id ?? null, imei);
    setVinculoAtual(imei);
    setImeiSelecionado('');
    setImeiBusca('');
  };

  const desvincular = () => {
    onLinkDevice?.(initialData?.id ?? null, '');
    setVinculoAtual('');
  };

  return (
    <Modal open={open} onClose={onClose} title={mode==='edit'?'Editar veículo':'Novo veículo'} width="max-w-5xl">
      <Tabs tabs={['Dados','Vincular','Histórico']} current={tab} onChange={setTab} />

      {tab==='Dados' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="grid gap-3">
            <LInput  label="Cliente *" value={f.cliente} onChange={on('cliente')} />
            <LSelect label="Tipo *" value={f.tipo} onChange={on('tipo')}>
              <option value="">Selecione…</option>
              <option value="leve">Leve</option>
              <option value="pesado">Pesado</option>
              <option value="implemento">Implemento</option>
              <option value="maquina">Máquina</option>
            </LSelect>
            <LInput  label="Placa *" value={f.placa} onChange={on('placa')} />
            <LInput  label="Identificador" value={f.identificador} onChange={on('identificador')} />
            <LInput  label="Grupo" value={f.grupo} onChange={on('grupo')} />
            <LInput  label="Classificação" value={f.classificacao} onChange={on('classificacao')} />
            <LInput  label="Ano Modelo" value={f.anoModelo} onChange={on('anoModelo')} />
            <LInput  label="Ano de Fabricação" value={f.anoFabricacao} onChange={on('anoFabricacao')} />
          </div>

          <div className="grid gap-3">
            <LInput  label="Modelo *" value={f.modelo} onChange={on('modelo')} />
            <LInput  label="Marca" value={f.marca} onChange={on('marca')} />
            <LInput  label="Chassi" value={f.chassi} onChange={on('chassi')} />
            <LInput  label="Renavam" value={f.renavam} onChange={on('renavam')} />
            <LInput  label="Cor" value={f.cor} onChange={on('cor')} />
            <LInput  label="Código FIPE" value={f.codigoFipe} onChange={on('codigoFipe')} />
            <LInput  label="Valor FIPE" value={f.valorFipe} onChange={on('valorFipe')} />
            <LSelect label="Zero Km" value={f.zeroKm} onChange={on('zeroKm')}>
              <option>Não</option><option>Sim</option>
            </LSelect>
          </div>

          <div className="md:col-span-2">
            <LTextArea label="Observações" value={f.observacoes} onChange={on('observacoes')} />
          </div>
        </div>
      )}

      {tab==='Vincular' && (
        <div className="grid gap-3">
          <div className="grid md:grid-cols-3 gap-3">
            <LInput  label="Buscar/Informar IMEI" value={imeiBusca} onChange={e=>setImeiBusca(e.target.value)} />
            <LInput  label="Selecionar IMEI (lista/sugestão)" value={imeiSelecionado} onChange={e=>setImeiSelecionado(e.target.value)} />
            <div className="flex items-end gap-2">
              <Button onClick={vincular}>Vincular ao veículo</Button>
              {vinculoAtual && <Button onClick={desvincular}>Desvincular</Button>}
            </div>
          </div>
          <div className="text-sm muted">
            IMEI atual vinculado: <b>{vinculoAtual || 'nenhum'}</b>
          </div>
        </div>
      )}

      {tab==='Histórico' && (
        <div className="text-sm muted">Histórico/Logs do veículo (placeholder).</div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar}>{mode==='edit'?'Salvar alterações':'Salvar'}</Button>
      </div>
    </Modal>
  );
}
