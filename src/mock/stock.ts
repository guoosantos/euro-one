export async function fetchStockMock({ lat, lng, raioKm }:{lat:number;lng:number;raioKm:number}) {
  const seed = Math.abs(Math.round(lat*1000+lng*1000+raioKm));
  const disponiveis = (seed % 37) + 3, vinculados = (seed % 19) + 1, tecnicos = (seed % 9) + 1;
  return { disponiveis, vinculados, tecnicos, total: disponiveis+vinculados };
}
