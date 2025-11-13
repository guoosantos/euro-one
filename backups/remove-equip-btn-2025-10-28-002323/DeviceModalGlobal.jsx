import React, {useEffect, useState} from 'react'
import DeviceModal from './DeviceModal'

export default function DeviceModalGlobal(){
  const [open,setOpen] = useState(false)
  useEffect(()=>{
    const onEvt = ()=>setOpen(true)
    const onKey = (e)=>{ if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='n'){ setOpen(true) } }
    window.addEventListener('device:new', onEvt)
    window.addEventListener('keydown', onKey)
    return ()=>{ window.removeEventListener('device:new', onEvt); window.removeEventListener('keydown', onKey) }
  },[])
  return (
    <>
      <button
        aria-label="Novo equipamento"
        onClick={()=>setOpen(true)}
        style={{
          position:'fixed', right:'18px', bottom:'18px', zIndex:55,
          padding:'12px 14px', borderRadius:'12px',
          background:'#1b6ea7', color:'#eef6ff', border:'1px solid #1b6ea7',
          boxShadow:'0 6px 18px rgba(0,0,0,.35)'
        }}>
        + Equipamento
      </button>
      <DeviceModal open={open} onClose={()=>setOpen(false)} onSave={(p)=>{ console.log('SALVAR EQUIPAMENTO', p) }} />
    </>
  )
}
