import React, { useEffect, useState, useCallback } from 'react';
import VehicleModal from './VehicleModal';

export default function VehicleModalGlobal(){
  const [open, setOpen] = useState(false);

  const hook = useCallback(() => {
    // procura botões/links que contenham "Novo veículo"
    const candidates = Array.from(document.querySelectorAll('button, a'))
      .filter(el => /novo\s+ve[ií]culo/i.test(el.textContent || ''));
    candidates.forEach(el => {
      if (!el.__euroVehHooked) {
        el.addEventListener('click', (ev) => {
          // deixa o click funcionar pro resto (ex.: não abre outro modal)
          ev.preventDefault();
          setOpen(true);
        });
        el.__euroVehHooked = true;
      }
    });
  }, []);

  useEffect(() => {
    hook();
    const obs = new MutationObserver(hook);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [hook]);

  const handleSave = (data) => {
    console.log('VEHICLE_SAVE_PAYLOAD', data);
    // TODO: integrar com seu backend (POST)
  };

  return <VehicleModal open={open} onClose={()=>setOpen(false)} onSave={handleSave} />;
}
