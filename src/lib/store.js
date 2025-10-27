import { create } from 'zustand'
export const useUI = create((set)=>({ sidebarOpen:false, toggle:()=>set(s=>({sidebarOpen:!s.sidebarOpen})) }))
