import React from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
export default function SimpleBar({ data }) {
  const chartTooltipStyle = {
    background: "var(--chart-tooltip-bg)",
    border: "1px solid var(--chart-tooltip-border)",
    color: "var(--chart-tooltip-text)",
    borderRadius: 12,
  };

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="var(--chart-grid-soft)" vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false}
                 tick={{ fill: 'var(--chart-tick-soft)', fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false}
                 tick={{ fill: 'var(--chart-tick-soft)', fontSize: 12 }} />
          <Tooltip contentStyle={chartTooltipStyle} />
          <Bar dataKey="value" radius={[6,6,0,0]} fill="rgba(57,189,248,0.85)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
