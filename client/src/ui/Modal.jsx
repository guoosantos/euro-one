import React from 'react'
export default function Modal({open, title, onClose, children, footer=null, width='max-w-5xl'}) {
  if(!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose}/>
      <div className={`relative z-50 w-[95vw] ${width}`}>
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="h1">{title}</div>
            <button className="btn" onClick={onClose}>Fechar</button>
          </div>
          {children}
          {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </div>
      </div>
    </div>
  )
}
