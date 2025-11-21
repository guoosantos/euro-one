import React from 'react'
export default function Sparkline({ values=[4,6,5,8,7,9,6,7], width=90, height=24 }) {
  if (!values.length) return null
  const min = Math.min(...values), max = Math.max(...values)
  const norm = v => {
    if (max === min) return height/2
    return height - ((v - min) / (max - min)) * height
  }
  const step = width / (values.length - 1)
  const d = values.map((v,i)=> `${i===0?'M':'L'} ${i*step} ${norm(v)}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="opacity-70">
      <path d={d} fill="none" stroke="url(#g)" strokeWidth="2" />
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#39BDF8"/>
          <stop offset="100%" stopColor="#39BDF8"/>
        </linearGradient>
      </defs>
    </svg>
  )
}
