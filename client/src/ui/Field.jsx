import React from 'react'
export default function Field({label, children}) {
  return (
    <div className="legend-card">
      <div className="legend">{label}</div>
      <div className="mt-2">{children}</div>
    </div>
  )
}
