import React from 'react'
export default function Field({label, children}) {
  return (
    <div className="relative card">
      <div className="legend" style={{position:'absolute',top:'-10px',left:'14px',padding:'2px 8px',
        fontSize:'12px',lineHeight:'16px',borderRadius:'10px',background:'#0f1115',border:'1px solid #1f2430',color:'#AAB1C2'}}>{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
}
