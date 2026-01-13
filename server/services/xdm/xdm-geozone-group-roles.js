export const ITINERARY_GEOZONE_GROUPS = {
  itinerary: { key: "itinerary", label: "ITINERARIO", index: 1 },
  targets: { key: "targets", label: "ALVOS", index: 2 },
  entry: { key: "entry", label: "ENTRADA", index: 3 },
};

export const GEOZONE_GROUP_ROLE_LIST = Object.values(ITINERARY_GEOZONE_GROUPS);

export function buildItineraryGroupScopeKey(itineraryId, roleKey) {
  return `itinerary:${itineraryId}:${roleKey}`;
}

export default {
  ITINERARY_GEOZONE_GROUPS,
  GEOZONE_GROUP_ROLE_LIST,
  buildItineraryGroupScopeKey,
};
