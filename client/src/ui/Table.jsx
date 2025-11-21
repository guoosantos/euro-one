import React from 'react'
export function Table({head=[], rows=[]}) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead className="text-left muted">
          <tr>{head.map((h,i)=><th key={i} className="py-2 pr-4 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length? rows.map((r,i)=>
            <tr key={i} className="border-t border-stroke/60">
              {r.map((c,j)=><td key={j} className="py-2 pr-4 whitespace-nowrap">{c}</td>)}
            </tr>
          ): <tr><td className="py-3 muted" colSpan={head.length}>Sem dados.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
export function Pager({page=1, pages=1, onPrev=()=>{}, onNext=()=>{}}){
  return (
    <div className="flex items-center justify-between text-sm mt-3">
      <div>Mostrando 0 de 0</div>
      <div className="flex items-center gap-2">
        <button className="btn" onClick={onPrev} disabled={page<=1}>‹</button>
        <div>Página {page}</div>
        <button className="btn" onClick={onNext} disabled={page>=pages}>›</button>
      </div>
    </div>
  )
}
