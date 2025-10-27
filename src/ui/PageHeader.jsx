import React from 'react'
export default function PageHeader({title, right=null, subtitle=null}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div>
        <div className="h1">{title}</div>
        {subtitle && <div className="text-sm text-sub"> {subtitle} </div>}
      </div>
      <div className="flex items-center gap-2 text-[12px] text-sub">
        <div>Última sincronização: 0s</div>
        {right}
      </div>
    </div>
  )
}
