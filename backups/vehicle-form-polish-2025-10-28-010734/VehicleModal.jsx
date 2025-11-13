import React, { useState } from 'react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import LInput from '../ui/LInput';
import LSelect from '../ui/LSelect';
import LTextArea from '../ui/LTextArea';

export default function VehicleModal({ open, onClose, onSave }) {
  const [f, setF] = useState({
    cliente:'', tipo:'', placa:'', identificador:'',
    modelo:'', marca:'', chassi:'', renavam:'', cor:'',
    anoModelo:'', anoFabricacao:'', codigoFipe:'', valorFipe:'',
    zeroKm:false, classificacao:'', grupo:'', observacoes:''
  });
  const on = (k) => (e) => setF(s => ({ ...s, [k]: e?.target?.type === 'checkbox' ? e.target.checked : e.target.value }));

  const salvar = () => {
    const obrig = [['cliente','Cliente'],['tipo','Tipo'],['placa','Placa'],['modelo','Modelo']];
    const falt = obrig.filter(([k]) => !String(f[k]||'').trim()).map(([,l])=>l);
    if (falt.length) { alert('Preencha: ' + falt.join(', ')); return; }
    onSave?.(f); onClose?.();
  };

  return (
    <Modal open={open} onClose={onClose} title="Novo veículo" width="max-w-5xl">
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
        </div>
        <div className="grid gap-3">
          <LInput  label="Modelo *" value={f.modelo} onChange={on('modelo')} />
          <LInput  label="Marca" value={f.marca} onChange={on('marca')} />
          <LInput  label="Chassi" value={f.chassi} onChange={on('chassi')} />
          <LInput  label="Renavam" value={f.renavam} onChange={on('renavam')} />
          <LInput  label="Cor" value={f.cor} onChange={on('cor')} />
        </div>
        <div className="grid gap-3">
          <LInput  label="Ano Modelo" value={f.anoModelo} onChange={on('anoModelo')} />
          <LInput  label="Ano de Fabricação" value={f.anoFabricacao} onChange={on('anoFabricacao')} />
          <LInput  label="Código FIPE" value={f.codigoFipe} onChange={on('codigoFipe')} />
          <LInput  label="Valor FIPE" value={f.valorFipe} onChange={on('valorFipe')} />
          <div className="lwrap">
            <span className="legend">Zero Km</span>
            <label className="linput flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={f.zeroKm} onChange={on('zeroKm')} />
              <span>{f.zeroKm ? 'Sim' : 'Não'}</span>
            </label>
          </div>
        </div>
        <div className="grid gap-3 md:col-span-2">
          <LTextArea label="Observações" value={f.observacoes} onChange={on('observacoes')} />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar}>Salvar</Button>
      </div>
    </Modal>
  );
}
