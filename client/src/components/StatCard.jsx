import React from 'react'
import Sparkline from './Sparkline'
export default function StatCard({ title, value, subtitle, series=[5,6,6,7,6,7,7,6] }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <div className="stat-title">{title}</div>
          <div className="stat-value mt-1">{value}</div>
          {subtitle && <div className="mt-1 text-[12px] text-sub">{subtitle}</div>}
        </div>
        <Sparkline values={series}/>
      </div>
    </div>
  )
}
