import React from 'react'
export default function KPI({tone='default', icon=null, title, value='0', hint=null}) {
  const tones = {
    default: 'bg-card',
    green: 'bg-card ring-1 ring-green/20',
    yellow: 'bg-card ring-1 ring-yellow/20',
    red: 'bg-card ring-1 ring-red/20',
    blue: 'bg-card ring-1 ring-primary/20',
  }
  return (
    <div className={`card ${tones[tone]||tones.default}`}>
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-sub font-semibold uppercase tracking-wide">{title}</div>
        {icon}
      </div>
      <div className="mt-2 text-[28px] leading-7 font-semibold">{value}</div>
      {hint && <div className="mt-1 text-[12px] text-sub">{hint}</div>}
    </div>
  )
}
