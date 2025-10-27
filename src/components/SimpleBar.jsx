import React from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
export default function SimpleBar({ data }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false}
                 tick={{ fill: 'rgba(234,236,240,0.65)', fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false}
                 tick={{ fill: 'rgba(234,236,240,0.65)', fontSize: 12 }} />
          <Tooltip contentStyle={{ background:'#161922', border:'1px solid #1f2430', borderRadius:12 }}/>
          <Bar dataKey="value" radius={[6,6,0,0]} fill="rgba(57,189,248,0.85)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
