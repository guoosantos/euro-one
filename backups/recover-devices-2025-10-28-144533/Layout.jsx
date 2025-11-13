import DeviceModalGlobal from "../components/DeviceModalGlobal";
import React from 'react'
import Sidebar from '../components/Sidebar'
import { Topbar } from '../components/Topbar'
import ErrorBoundary from '../components/ErrorBoundary';
export default function Layout({children,title}){
  return (
    <div className="min-h-screen flex">
      <Sidebar/>
      <div className="flex-1 flex flex-col">
        <Topbar/>
        <main className="mx-auto w-full max-w-7xl p-4 space-y-4">
          {title && <h1 className="text-xl font-semibold">{title}</h1>}
          <ErrorBoundary>{children}</ErrorBoundary>
        <DeviceModalGlobal />
        </main>
      </div>
    </div>
  )
}
