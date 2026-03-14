import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distRoot = path.join(repoRoot, "client", "dist");
const assetsRoot = path.join(distRoot, "assets");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function write(filePath, contents) {
  fs.writeFileSync(filePath, contents);
}

function findAssetByPattern(pattern) {
  return fs.readdirSync(assetsRoot).find((entry) => pattern.test(entry)) || null;
}

function replaceAllLiteral(source, from, to) {
  return source.includes(from) ? source.replaceAll(from, to) : source;
}

function overwriteVehicleMarkerChunk(filePath, mainAsset) {
  const source = `import { F as resolveVehicleIconTypeBase, z as leafletNs, G as getVehicleIconAsset, H as getVehicleIconSvg } from "./${mainAsset}";

const markerIconCache = new Map();
const HEADING_STEP_DEGREES = 5;
const GLYPH_SCALE = 1.12;
const GLYPH_SIZE = 30;
const MARKER_ICON_SIZE = [48, 48];
const MARKER_ICON_ANCHOR = [24, 24];
const MARKER_POPUP_ANCHOR = [0, -30];
const TYPE_ALIASES = {
  truck: ["truck", "caminhao", "caminhão", "caminhoes", "caminhões", "carreta", "reboque", "semi", "lorry", "scania", "volvo", "iveco", "daf", "actros", "atego", "accelo", "cargo", "fh", "fh 540", "r 450", "s 500", "mercedes", "mercedes-benz", "volkswagen", "vw", "man"],
  pickup: ["pickup", "pick-up", "pick up", "picape", "camionete", "rampage", "ram", "hilux", "s10", "strada"],
  car: ["car", "carro", "auto", "automovel", "automóvel", "veiculo", "veículo", "sedan", "hatch", "suv"],
  motorcycle: ["motorcycle", "moto", "motocicleta", "bike"],
  person: ["person", "pessoa", "pedestrian", "walker"],
  airtag: ["airtag", "air tag", "tag", "beacon"],
  bait: ["bait", "isca"],
  pet: ["pet", "dog", "cat", "cachorro", "gato"],
  machine: ["machine", "maquina", "máquina", "tractor", "trator", "escavadeira", "retroescavadeira", "loader"],
};

function normalizeCandidate(value) {
  if (value === null || value === void 0) return null;
  const stringValue = String(value).trim();
  return stringValue || null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveIconAlias(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some((alias) => normalized.includes(alias))) return type;
  }
  return null;
}

function normalizeImageUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\\/\\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return null;
}

function isCustomResolvedType(value) {
  const candidate = normalizeCandidate(value);
  if (!candidate) return false;
  const resolved = resolveVehicleIconTypeBase(candidate);
  return typeof resolved === "string" && resolved.startsWith("custom-");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function coerceIgnitionBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["1", "true", "on", "ligado", "ligada", "sim", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "desligado", "desligada", "nao", "no"].includes(normalized)) return false;
  return null;
}

function resolveIgnitionState({ acc, ignition, ignitionLabel, attributes, color } = {}) {
  const safeAttributes = attributes && typeof attributes === "object" ? attributes : {};
  const fromAcc = coerceIgnitionBoolean(
    acc ??
      safeAttributes.acc ??
      safeAttributes.ACC ??
      safeAttributes.ign ??
      safeAttributes.input5 ??
      safeAttributes.digitalinput5 ??
      safeAttributes.digitalInput5 ??
      safeAttributes.signalin5 ??
      safeAttributes.signalIn5 ??
      safeAttributes.in5 ??
      safeAttributes.io19,
  );
  if (fromAcc !== null) return fromAcc ? "on" : "off";
  const fromIgnition = coerceIgnitionBoolean(ignition ?? safeAttributes.ignition ?? safeAttributes.ignitionState);
  if (fromIgnition !== null) return fromIgnition ? "on" : "off";
  const normalizedLabel = String(ignitionLabel || "").trim().toLowerCase();
  if (normalizedLabel.includes("deslig")) return "off";
  if (normalizedLabel.includes("lig")) return "on";
  const normalizedColor = String(color || "").trim().toLowerCase();
  if (normalizedColor === "#22c55e") return "on";
  if (normalizedColor === "#ef4444") return "off";
  return "unknown";
}

function normalizeMarkerSvg(rawSvg = "", baseColor) {
  if (!rawSvg) return "";
  let iconSvg = rawSvg
    .replace(/stroke=["']currentColor["']/g, \`stroke="\${baseColor}"\`)
    .replace(/fill=["']currentColor["']/g, \`fill="\${baseColor}"\`);
  if (!/preserveAspectRatio=["'][^"']+["']/i.test(iconSvg)) {
    iconSvg = iconSvg.replace("<svg", '<svg preserveAspectRatio="xMidYMid meet"');
  }
  return iconSvg;
}

function resolveMarkerIconType(payload = {}, fallbackCandidates = []) {
  const attributes = payload && typeof payload === "object" ? payload.attributes || {} : {};
  const extraCandidates = Array.isArray(fallbackCandidates) ? fallbackCandidates : [fallbackCandidates];
  const customPreferred = [
    payload?.iconType,
    payload?.vehicleType,
    payload?.type,
    payload?.category,
    attributes.iconType,
    attributes.vehicleType,
    attributes.type,
    attributes.category,
    ...extraCandidates,
  ].map(normalizeCandidate).filter(Boolean).find((candidate) => isCustomResolvedType(candidate));
  if (customPreferred) {
    return resolveVehicleIconTypeBase(customPreferred);
  }
  const candidates = [
    payload?.iconType,
    payload?.vehicleType,
    payload?.type,
    payload?.category,
    payload?.label,
    payload?.deviceName,
    payload?.vehicleName,
    payload?.make,
    payload?.brand,
    payload?.manufacturer,
    payload?.vendor,
    payload?.model,
    payload?.modelName,
    payload?.vehicleModel,
    payload?.vehicleBrand,
    payload?.displayName,
    payload?.description,
    payload?.name,
    attributes.iconType,
    attributes.vehicleType,
    attributes.type,
    attributes.category,
    attributes.label,
    attributes.deviceName,
    attributes.vehicleName,
    attributes.make,
    attributes.brand,
    attributes.manufacturer,
    attributes.vendor,
    attributes.model,
    attributes.modelName,
    attributes.vehicleModel,
    attributes.vehicleBrand,
    attributes.displayName,
    attributes.description,
    attributes.name,
    ...extraCandidates,
  ].map(normalizeCandidate).filter(Boolean);
  const aliasMatch = candidates.map(resolveIconAlias).find(Boolean);
  if (aliasMatch) return aliasMatch;
  const chosen = candidates.find(Boolean) || "other";
  return resolveVehicleIconTypeBase(chosen);
}

function resolveMarkerImageUrl(payload = {}, fallbackCandidates = []) {
  const attributes = payload && typeof payload === "object" ? payload.attributes || {} : {};
  const candidates = [
    payload,
    attributes,
    ...(Array.isArray(fallbackCandidates) ? fallbackCandidates : [fallbackCandidates]),
  ].filter((entry) => entry && typeof entry === "object");
  const keys = ["imageUrl", "iconUrl", "iconImage", "markerIcon", "markerImage", "iconSrc", "image", "icon", "customIcon"];
  for (const source of candidates) {
    for (const key of keys) {
      const direct = normalizeImageUrl(source?.[key]);
      if (direct) return direct;
      const nested = source?.[key];
      if (nested && typeof nested === "object") {
        const nestedUrl = normalizeImageUrl(nested?.url || nested?.src || nested?.value);
        if (nestedUrl) return nestedUrl;
      }
    }
  }
  return null;
}

function buildGlyphHtml({ resolvedType, baseColor, imageUrl = null }) {
  const customImageUrl = normalizeImageUrl(imageUrl);
  const iconAsset = getVehicleIconAsset(resolvedType);
  const assetImageUrl = iconAsset?.kind === "image" ? iconAsset.value : null;
  const emoji = iconAsset?.kind === "emoji" ? iconAsset.value : null;
  if (customImageUrl || assetImageUrl) {
    return \`<img src="\${escapeHtml(customImageUrl || assetImageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:999px;display:block;" />\`;
  }
  if (emoji) {
    return \`<span style="display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:22px;line-height:1;">\${escapeHtml(emoji)}</span>\`;
  }
  return normalizeMarkerSvg(getVehicleIconSvg(resolvedType), baseColor);
}

function createVehicleMarkerIcon({
  bearing = 0,
  color,
  accentColor,
  iconType,
  vehicleType,
  type,
  category,
  label,
  plate,
  muted = false,
  ignition = null,
  ignitionLabel = "",
  acc,
  attributes,
  status,
  speed,
  isMoving = false,
  selected = false,
  zoomLevel = null,
  imageUrl = null,
} = {}) {
  if (!leafletNs?.divIcon) return null;
  const resolvedType = resolveMarkerIconType({ iconType, vehicleType, type, category, attributes });
  const resolvedImageUrl = resolveMarkerImageUrl({ imageUrl, iconType, vehicleType, type, category, attributes });
  const rawHeading = Number.isFinite(bearing) ? Number(bearing) : 0;
  const heading = Math.round(rawHeading / HEADING_STEP_DEGREES) * HEADING_STEP_DEGREES;
  const labelText = escapeHtml((label || plate || "").trim());
  const ignitionState = resolveIgnitionState({ acc, ignition, ignitionLabel, attributes, color });
  const cacheKey = \`\${resolvedType || "default"}-\${resolvedImageUrl || "no-image"}-\${color || "default"}-\${accentColor || "none"}-\${heading}-\${muted}-\${ignitionState}-\${selected}-\${labelText || "-"}-\${status || ""}-\${speed || ""}-\${isMoving}-\${zoomLevel || ""}\`;
  if (markerIconCache.has(cacheKey)) return markerIconCache.get(cacheKey);
  const arrowColor = color || "#60a5fa";
  const ringColor = accentColor || "rgba(148,163,184,0.35)";
  const baseColor = color || "#94a3b8";
  const glyphHtml = buildGlyphHtml({ resolvedType, baseColor, imageUrl: resolvedImageUrl });
  const opacity = muted ? 0.64 : 1;
  const filter = muted ? "saturate(0.78) brightness(0.9)" : "none";
  const labelHtml = labelText
    ? \`<div class="fleet-marker__label" style="position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);max-width:170px;">\${labelText}</div>\`
    : "";
  const html = \`
    <div class="fleet-marker__wrap" data-ignition="\${ignitionState}" style="opacity:\${opacity};filter:\${filter};width:\${MARKER_ICON_SIZE[0]}px;height:\${MARKER_ICON_SIZE[1]}px;transform:none;">
      <div class="fleet-marker__stack" style="--fleet-marker-heading:\${heading}deg;gap:0;">
        \${labelHtml}
        <div class="fleet-marker__base" style="border:1px solid \${ringColor};color:\${baseColor};">
          <div class="fleet-marker__ring" aria-hidden="true"></div>
          <span class="fleet-marker__glyph fleet-marker__icon" style="width:\${GLYPH_SIZE}px;height:\${GLYPH_SIZE}px;transform:scale(\${GLYPH_SCALE});">\${glyphHtml}</span>
          <div class="fleet-marker__arrow">
            <svg viewBox="0 0 24 24" fill="\${arrowColor}" stroke="rgba(15,23,42,0.8)" stroke-width="1.2">
              <path d="M12 2l7 9h-4v11h-6V11H5z" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  \`;
  const icon = leafletNs.divIcon({
    className: "fleet-marker",
    html,
    iconSize: MARKER_ICON_SIZE,
    iconAnchor: MARKER_ICON_ANCHOR,
    popupAnchor: MARKER_POPUP_ANCHOR,
  });
  markerIconCache.set(cacheKey, icon);
  return icon;
}

export { createVehicleMarkerIcon as c, resolveMarkerIconType as r };
`;
  write(filePath, source);
}

function patchIgnitionOffTone() {
  const current =
    "border-rose-400/60 bg-rose-500/16 text-rose-300 shadow-[0_0_0_1px_rgba(251,113,133,0.18),inset_0_-1px_0_0_rgba(251,113,133,0.4)]";
  const next =
    "border-red-500/70 bg-red-500/18 text-red-500 shadow-[0_0_0_1px_rgba(239,68,68,0.22),inset_0_-1px_0_0_rgba(239,68,68,0.42)]";
  const ignitionSvgCurrent =
    'n.jsxs("svg",{viewBox:"0 0 24 24",className:"h-3.5 w-3.5",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"';
  const ignitionSvgNext =
    'n.jsxs("svg",{viewBox:"0 0 24 24",className:"h-3.5 w-3.5",fill:"none",stroke:a?"#34d399":"#ef4444",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round"';

  for (const entry of fs.readdirSync(assetsRoot)) {
    if (!/^Monitoramento-.*\.js$/.test(entry)) continue;
    const targetPath = path.join(assetsRoot, entry);
    const original = read(targetPath);
    let updated = original.includes(current) ? original.replaceAll(current, next) : original;
    if (updated.includes(ignitionSvgCurrent)) {
      updated = updated.replaceAll(ignitionSvgCurrent, ignitionSvgNext);
    }
    if (updated !== original) {
      write(targetPath, updated);
    }
  }
}

function patchMonitoringTableLogic() {
  const statusCurrent =
    'key:"status",labelKey:"monitoring.columns.status",defaultVisible:!0,getValue:e=>{var s;if((s=e.statusBadge)!=null&&s.label)return e.statusBadge.label;const t=Gl(e.position);return t==="online"?"Online":t==="alert"?"Alerta":t==="blocked"?"Bloqueado":e.connectionStatusLabel||"Offline"}';
  const statusNext =
    'key:"status",labelKey:"monitoring.columns.status",defaultVisible:!0,getValue:e=>Gl(e.position)==="offline"?"Offline":"Online"';
  const blockedCurrent =
    'key:"blocked",labelKey:"monitoring.columns.blocked",defaultVisible:!1,getValue:(e,t={})=>{var m,N,c;const s=t.t?t.t("common.yes"):"Sim",l=t.t?t.t("common.no"):"Não",a=yt(e);if(typeof(e==null?void 0:e.blocked)=="boolean")return e.blocked?s:l;if(String(((m=e.position)==null?void 0:m.protocol)||((N=e.device)==null?void 0:N.protocol)||a.protocol||"").toLowerCase().includes("iotm")){const w=Ri(e),_=fa(w);if(_!==null)return _?s:l}const p=Mi(((c=e.position)==null?void 0:c.blocked)??a.blocked);return p!==null?p?s:l:Me}';
  const blockedNext =
    'key:"blocked",labelKey:"monitoring.columns.blocked",defaultVisible:!1,getValue:(e,t={})=>{const s=t.t?t.t("common.yes"):"Sim",l=t.t?t.t("common.no"):"Não",a=String(fd(yt(e))||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().trim();return a&&!a.includes("nao bloqueado")&&!a.includes("desbloqueado")&&!a.includes("sem bloqueio")&&!a.includes("sem anomalia")&&!a.includes("sem anomalias")&&!a.includes("funcionando")&&!a.includes("normal")?s:l}';
  const modulesCurrent =
    'key:"input2Jammer",labelKey:"monitoring.columns.input2Jammer",defaultVisible:!0,getValue:(e,t={})=>{const s=ji(e)?_i(e,2):Ti(e,["input2","digitalinput2","digitalInput2","signalIn2","in2"]);if(!ji(e))return Jd(s,t);const l=Mi(s);return l===null?Me:l?"JUMPEADO / DESLIGADO":"FUNCIONANDO"}';
  const modulesNext =
    'key:"input2Jammer",labelKey:"monitoring.columns.input2Jammer",defaultVisible:!0,getValue:(e,t={})=>{const s=ji(e)?_i(e,2):Ti(e,["input2","digitalinput2","digitalInput2","signalIn2","in2"]),l=ji(e)?_i(e,4):Ti(e,["input4","digitalinput4","digitalInput4","signalIn4","in4"]),a=Mi(s),u=Mi(l);return a&&u?"Jammer, Painel":a?"Jammer":u?"Painel":"FUNCIONANDO"}';

  for (const entry of fs.readdirSync(assetsRoot)) {
    if (!/^Monitoramento-.*\.js$/.test(entry)) continue;
    const targetPath = path.join(assetsRoot, entry);
    const original = read(targetPath);
    let updated = original;
    updated = replaceAllLiteral(updated, statusCurrent, statusNext);
    updated = replaceAllLiteral(updated, blockedCurrent, blockedNext);
    updated = replaceAllLiteral(updated, modulesCurrent, modulesNext);
    if (updated !== original) {
      write(targetPath, updated);
    }
  }
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`assets ausente: ${assetsRoot}`);
  }

  const mainAsset = findAssetByPattern(/^index-.*\.js$/);
  const markerAsset = findAssetByPattern(/^vehicleMarkerIcon-.*\.js$/);

  if (!mainAsset || !markerAsset) {
    throw new Error(`Assets esperados ausentes: main=${mainAsset} marker=${markerAsset}`);
  }

  overwriteVehicleMarkerChunk(path.join(assetsRoot, markerAsset), mainAsset);
  patchIgnitionOffTone();
  patchMonitoringTableLogic();
  process.stdout.write("OK: ajustes de monitoramento e icones aplicados\n");
}

main();
