import React from 'react'
export default function QuickCard({ icon:Icon, title, subtitle, onClick }) {
  return (
    <button onClick={onClick} className="card group hover:bg-stroke/40 transition text-left w-full">
      <div className="flex items-center gap-3">
        {Icon && <Icon size={18} className="opacity-80" />}
        <div className="font-medium">{title}</div>
      </div>
      {subtitle && <div className="mt-1 text-sm muted">{subtitle}</div>}
    </button>
  )
}
