export function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

export function calculateDistanceMeters(from, to) {
  if (!from || !to) return 0;
  const lat1 = toRadians(from.latitude ?? from.lat ?? 0);
  const lon1 = toRadians(from.longitude ?? from.lng ?? 0);
  const lat2 = toRadians(to.latitude ?? to.lat ?? 0);
  const lon2 = toRadians(to.longitude ?? to.lng ?? 0);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

export function isWithinDistanceMeters(from, to, maxMeters) {
  const distance = calculateDistanceMeters(from, to);
  return distance <= maxMeters;
}

export default {
  toRadians,
  calculateDistanceMeters,
  isWithinDistanceMeters,
};
