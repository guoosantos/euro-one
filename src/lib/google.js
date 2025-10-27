export function loadGooglePlaces() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_KEY
  if (!key) return Promise.resolve(null)
  if (window.google?.maps?.places) return Promise.resolve(window.google)
  const src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&v=weekly`
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script'); s.src=src; s.async=true; s.onerror=reject
    s.onload=()=>resolve(window.google); document.head.appendChild(s)
  })
}
