const VEHICLE_ICON_ASSETS = {
  car: {
    label: "Carro",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 13l2.4-5.2A2.2 2.2 0 0 1 7.4 6h9.2a2.2 2.2 0 0 1 2 1.2L21 12v6a1 1 0 0 1-1 1h-1.4" />
        <path d="M5 18h-1a1 1 0 0 1-1-1v-4.2" />
        <path d="M4 12h16" />
        <circle cx="7.5" cy="18" r="2" />
        <circle cx="16.5" cy="18" r="2" />
      </svg>
    `,
  },
  truck: {
    label: "Caminhão",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="8" width="11" height="7" rx="1.5" />
        <path d="M13 10h4.6l2.4 2.8V15H13z" />
        <circle cx="7" cy="17" r="2" />
        <circle cx="17" cy="17" r="2" />
      </svg>
    `,
  },
  motorcycle: {
    label: "Moto",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6.5" cy="17" r="2.5" />
        <circle cx="17.5" cy="17" r="2.5" />
        <path d="M9 16l2.5-4.5h3l2 3.5" />
        <path d="M12 11l-1-2h-2" />
        <path d="M15 11h2l2 2" />
      </svg>
    `,
  },
  person: {
    label: "Pessoa",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="6.5" r="2.5" />
        <path d="M8.5 20v-4.5a3.5 3.5 0 0 1 7 0V20" />
        <path d="M8.5 14h7" />
      </svg>
    `,
  },
  airtag: {
    label: "AirTag",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="6" y="3" width="12" height="18" rx="6" />
        <circle cx="12" cy="10" r="3.5" />
        <path d="M12 13.5v4" />
      </svg>
    `,
  },
  default: {
    label: "Dispositivo",
    svg: `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="3" width="14" height="18" rx="3" />
        <path d="M9 7h6" />
        <path d="M8 12h8" />
        <path d="M10 17h4" />
      </svg>
    `,
  },
};

const TYPE_ALIASES = {
  car: ["car", "auto", "automovel", "automóvel", "sedan", "hatch", "suv", "van"],
  truck: [
    "truck",
    "caminhao",
    "caminhão",
    "lorry",
    "bus",
    "onibus",
    "ônibus",
    "semirremolque",
    "carreta",
    "tractor",
    "pickup",
  ],
  motorcycle: ["motorcycle", "moto", "motocicleta", "bike"],
  person: ["person", "pessoa", "pedestrian", "walker", "walk"],
  airtag: ["airtag", "air tag", "tag", "tracker", "beacon"],
};

export const VEHICLE_TYPE_OPTIONS = [
  { value: "car", label: "Carro" },
  { value: "truck", label: "Caminhão" },
  { value: "motorcycle", label: "Moto" },
  { value: "bus", label: "Ônibus" },
  { value: "van", label: "Van" },
  { value: "tractor", label: "Trator" },
  { value: "pickup", label: "Pickup" },
  { value: "other", label: "Outros" },
];

export function resolveVehicleIconType(rawType) {
  if (!rawType) return "default";
  const normalized = String(rawType).toLowerCase();
  const matched = Object.entries(TYPE_ALIASES).find(([, aliases]) =>
    aliases.some((alias) => normalized.includes(alias)),
  );
  return matched?.[0] || "default";
}

export function getVehicleIconAsset(rawType) {
  const key = resolveVehicleIconType(rawType);
  return VEHICLE_ICON_ASSETS[key] || VEHICLE_ICON_ASSETS.default;
}

export function getVehicleIconSvg(rawType) {
  return getVehicleIconAsset(rawType).svg;
}

export default VEHICLE_ICON_ASSETS;
