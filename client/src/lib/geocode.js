export async function geocodeAddress(q){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`Geocode HTTP ${r.status}`)
  const data = await r.json()
  if (!data?.length) return null
  const { lat, lon, display_name } = data[0]
  return { lat: +lat, lng: +lon, address: display_name }
}
