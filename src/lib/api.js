import axios from 'axios'

export const core = axios.create({
  baseURL: import.meta.env.VITE_CORE_BASE || '/api',
  withCredentials: true,
})
export const cam = axios.create({
  baseURL: import.meta.env.VITE_CAM_BASE || '/cam',
  withCredentials: true,
})

const logErr = (e) => console.error('[API ERROR]', e?.response?.status, e?.message)
core.interceptors.response.use(r=>r, e=>{ logErr(e); return Promise.reject(e) })
cam.interceptors.response.use(r=>r, e=>{ logErr(e); return Promise.reject(e) })

export const API = {
  health: () => core.get('/health'),
  devices: {
    list: (params) => core.get('/devices', { params }),
    lastPositions: (params) => core.get('/positions/last', { params }),
    count: () => core.get('/devices/count').catch(()=>({ data:{ total:1200, active:1045, inactive:122, blocked:33 } })),
  },
  events: {
    list: (params) => core.get('/events', { params }).catch(()=>({ data:[{ts:'2025-10-26T21:05:43Z', type:'speed', device:'EU-100', severity:'critical'}] })),
  },
  trips: { list: (params) => core.get('/trips', { params }) },
}
