import React from 'react'
import { Bell, Settings, User, Menu } from 'lucide-react'
import { useUI } from '../lib/store'
export function Topbar(){
  const toggle = useUI(s=>s.toggle)
  return (
    <header className="sticky top-0 z-10 bg-bg/70 backdrop-blur border-b border-stroke">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
        <button className="btn md:hidden" onClick={toggle}><Menu size={18}/></button>
        <div className="font-semibold">Euro One</div>
        <div className="flex items-center gap-2">
          <button className="btn"><Bell size={18}/></button>
          <button className="btn"><Settings size={18}/></button>
          <button className="btn"><User size={18}/></button>
        </div>
      </div>
    </header>
  )
}
