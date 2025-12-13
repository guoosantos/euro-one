export async function geocodeAddress(q){
  const url = `/api/geocode/search?query=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'include' })
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`)
  const payload = await r.json()
  const data = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : []
  if (!data?.length) return null
  const { lat, lng, label } = data[0]
  return { lat: +lat, lng: +lng, address: label }
}
