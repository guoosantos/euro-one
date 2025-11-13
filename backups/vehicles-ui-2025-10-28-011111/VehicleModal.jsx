import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import LInput from '../ui/LInput';
import LSelect from '../ui/LSelect';
import LTextArea from '../ui/LTextArea';

const onlyDigits = (s) => s.replace(/\D+/g,'');
const toUpper = (s) => (s||'').toUpperCase();

export default function VehicleModal({ open, onClose, onSave }) {
  const [f, setF] = useState({
    cliente:'', tipo:'', placa:'', identificador:'',
    modelo:'', marca:'', chassi:'', renavam:'', cor:'',
    anoModelo:'', anoFabricacao:'', codigoFipe:'', valorFipe:'',
    zeroKm:false, classificacao:'', grupo:'', observacoes:''
  });

  const set = (k, v) => setF(s=>({ ...s, [k]: v }));

  const onTxt = (k) => (e)=> set(k, e.target.value);
  const onUpper = (k) => (e)=> set(k, toUpper(e.target.value));
  const onDigits = (k, max=4) => (e)=> set(k, onlyDigits(e.target.value).slice(0,max));

  const salvar = () => {
    const obrig = [['cliente','Cliente'],['tipo','Tipo'],['placa','Placa'],['modelo','Modelo']];
    const falt = obrig.filter(([k]) => !String(f[k]||'').trim()).map(([,l])=>l);
    if (falt.length) { alert('Preencha: ' + falt.join(', ')); return; }
    onSave?.(f); onClose?.();
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo veículo" width="max-w-5xl">
      {/* Linha 1: Cliente / Tipo / Grupo */}
      <div className="row row-3">
        <LInput  label="Cliente *"   value={f.cliente} onChange={onTxt('cliente')} placeholder="Nome do cliente"/>
        <LSelect label="Tipo *"      value={f.tipo} onChange={onTxt('tipo')}>
          <option value="">Selecione…</option>
          <option value="leve">Leve</option>
          <option value="pesado">Pesado</option>
          <option value="implemento">Implemento</option>
          <option value="maquina">Máquina</option>
        </LSelect>
        <LInput  label="Grupo"       value={f.grupo} onChange={onTxt('grupo')} placeholder="Opcional"/>
      </div>

      {/* Linha 2: Placa / Identificador / Classificação */}
      <div className="row row-3">
        <LInput  label="Placa *"     value={f.placa} onChange={onUpper('placa')}
                 placeholder="ABC1D23" className="caps" maxLength={7}/>
        <LInput  label="Identificador" value={f.identificador} onChange={onTxt('identificador')} placeholder="Patrimônio, frota, etc."/>
        <LInput  label="Classificação" value={f.classificacao} onChange={onTxt('classificacao')} placeholder="Próprio, agregado…"/>
      </div>

      {/* Linha 3: Modelo / Marca / Cor */}
      <div className="row row-3">
        <LInput  label="Modelo *"    value={f.modelo} onChange={onTxt('modelo')} placeholder="FH 540, Actros, etc."/>
        <LInput  label="Marca"       value={f.marca} onChange={onTxt('marca')} placeholder="Volvo, MB, Scania…"/>
        <LSelect label="Cor"         value={f.cor} onChange={onTxt('cor')}>
          <option value="">Selecione…</option>
          <option>Branco</option><option>Preto</option><option>Prata</option><option>Cinza</option>
          <option>Azul</option><option>Vermelho</option><option>Verde</option><option>Amarelo</option>
          <option>Outro</option>
        </LSelect>
      </div>

      {/* Linha 4: Chassi / Renavam */}
      <div className="row row-2">
        <LInput  label="Chassi"      value={f.chassi} onChange={onUpper('chassi')} className="caps" maxLength={25}/>
        <LInput  label="Renavam"     value={f.renavam} onChange={onDigits('renavam', 11)} maxLength={11}/>
      </div>

      {/* Linha 5: Anos / FIPE */}
      <div className="row row-4">
        <LInput  label="Ano Modelo"        value={f.anoModelo} onChange={onDigits('anoModelo',4)} maxLength={4} placeholder="YYYY"/>
        <LInput  label="Ano de Fabricação" value={f.anoFabricacao} onChange={onDigits('anoFabricacao',4)} maxLength={4} placeholder="YYYY"/>
        <LInput  label="Código FIPE"       value={f.codigoFipe} onChange={onDigits('codigoFipe',7)} maxLength={7}/>
        <LInput  label="Valor FIPE"        value={f.valorFipe} onChange={onDigits('valorFipe',9)} maxLength={9} placeholder="apenas números"/>
      </div>

      {/* Linha 6: Zero Km toggle */}
      <div className="lwrap" style={{marginTop:4}}>
        <span className="legend">Zero Km</span>
        <div className="seg">
          <button type="button" className={f.zeroKm?'':'active'} onClick={()=>set('zeroKm', false)}>Não</button>
          <button type="button" className={f.zeroKm?'active':''} onClick={()=>set('zeroKm', true)}>Sim</button>
        </div>
      </div>

      {/* Observações */}
      <LTextArea label="Observações" value={f.observacoes} onChange={onTxt('observacoes')} placeholder="Informações adicionais, avarias, observações de frota…"/>

      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar}>Salvar</Button>
      </div>
    </Modal>
  );
}
