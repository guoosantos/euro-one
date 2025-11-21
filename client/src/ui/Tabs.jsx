import React from 'react'
export default function Tabs({tabs, current, onChange}) {
  return (
    <div className="flex gap-2 mb-4">
      {tabs.map(t=>(
        <button key={t} onClick={()=>onChange(t)}
          className={`px-3 py-2 rounded-xl border ${current===t?'bg-stroke/60 text-text border-stroke':'bg-card/60 text-sub border-stroke'}`}>
          {t}
        </button>
      ))}
    </div>
  )
}
