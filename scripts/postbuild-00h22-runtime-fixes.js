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

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index === -1) {
    if (source.includes(replacement)) {
      return source;
    }
    process.stdout.write(`SKIP: trecho não encontrado para ${label}\n`);
    return source;
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function findAssetByPattern(pattern) {
  return fs.readdirSync(assetsRoot).find((entry) => pattern.test(entry)) || null;
}

function patchMainMenuBundle(filePath) {
  const original = read(filePath);
  let updated = original;

  updated = replaceOnce(
    updated,
    '{key:"documentos",label:"Documentos",icon:Ed,children:[{to:"/drivers",label:"Motorista",icon:n0,permission:{menuKey:"fleet",pageKey:"documents",subKey:"drivers"}}]}',
    '{key:"documentos",label:"Documentos",icon:Ed,children:[{to:"/drivers",label:"Motorista",icon:n0,permission:{menuKey:"fleet",pageKey:"documents",subKey:"drivers"}},{to:"/documents",label:"Contratos",icon:Ed,permission:{menuKey:"fleet",pageKey:"documents",subKey:"contracts"}}]}',
    "menu documentos completo",
  );

  updated = replaceOnce(
    updated,
    '{to:"/analytics/risk-area",label:"Área de Risco",icon:wl,permission:{menuKey:"admin",pageKey:"analytics",subKey:"risk-area"}}]},{to:"/clients",label:"Clientes",icon:i0,permission:{menuKey:"admin",pageKey:"clients"},isVisible:({canManageUsers:e,isMirrorReceiver:t})=>e&&!t},{to:"/documents",label:"Documento",icon:Ed,permission:{menuKey:"fleet",pageKey:"documents",subKey:"contracts"}},{to:"/mirrors/received",label:"Espelhamento",icon:i0,permission:{menuKey:"admin",pageKey:"mirrors"},isVisible:({canManageUsers:e,isMirrorReceiver:t})=>e&&!t},{to:"/admin/import-euro-xlsx",label:"Importar Base (XLSX)",icon:fN,permission:{menuKey:"admin",pageKey:"import"},isVisible:({isEuroImportEnabled:e})=>e}',
    '{to:"/analytics/risk-area",label:"Área de Risco",icon:wl,permission:{menuKey:"admin",pageKey:"analytics",subKey:"risk-area"}},{to:"/analytics/security",label:"Segurança",icon:Ap,permission:{menuKey:"admin",pageKey:"analytics",subKey:"security-events"}}]},{to:"/clients",label:"Clientes",icon:i0,permission:{menuKey:"admin",pageKey:"clients"},isVisible:({canManageUsers:e,isMirrorReceiver:t})=>e&&!t},{to:"/users",label:"Usuários",icon:tg,permission:{menuKey:"admin",pageKey:"users"},isVisible:({canManageUsers:e})=>e},{to:"/mirrors/received",label:"Espelhamento",icon:i0,permission:{menuKey:"admin",pageKey:"mirrors"},isVisible:({canManageUsers:e,isMirrorReceiver:t})=>e&&!t},{to:"/admin/import-euro-xlsx",label:"Importar Base (XLSX)",icon:fN,permission:{menuKey:"admin",pageKey:"import"},isVisible:({isEuroImportEnabled:e})=>e}',
    "menu administracao usuarios",
  );

  if (updated !== original) {
    write(filePath, updated);
  }
}

function patchLivePositionsWebSocket(filePath) {
  const original = read(filePath);
  let updated = original;

  const currentInline = ',ve=!!(i&&E&&!s&&!o&&!T&&!f&&!he&&l!=="target"),';
  const nextInline = ",ve=!1,";

  if (updated.includes(currentInline)) {
    updated = updated.replace(currentInline, nextInline);
  }

  const currentStandalone = 'const ve=!!(i&&E&&!s&&!o&&!T&&!f&&!he&&l!=="target")';
  const nextStandalone = "const ve=!1";

  if (updated.includes(currentStandalone)) {
    updated = updated.replace(currentStandalone, nextStandalone);
  }

  if (updated !== original) {
    write(filePath, updated);
  }
}

function patchPermissionAndLoaderRuntime(filePath) {
  const original = read(filePath);
  let updated = original;

  updated = replaceOnce(
    updated,
    'return f.current.cleanup&&(f.current.cleanup(),f.current.cleanup=null),f.current.cleanup=c("Carregando..."),f.current.timer&&window.clearTimeout(f.current.timer),f.current.timer=window.setTimeout(()=>{f.current.cleanup&&(f.current.cleanup(),f.current.cleanup=null)},650),()=>{f.current.timer&&window.clearTimeout(f.current.timer)}}',
    'return f.current.cleanup&&(f.current.cleanup(),f.current.cleanup=null),f.current.timer&&window.clearTimeout(f.current.timer),f.current.timer=window.setTimeout(()=>{f.current.cleanup=c("Carregando..."),f.current.timer=window.setTimeout(()=>{f.current.cleanup&&(f.current.cleanup(),f.current.cleanup=null)},180)},450),()=>{f.current.timer&&window.clearTimeout(f.current.timer),f.current.cleanup&&(f.current.cleanup(),f.current.cleanup=null)}}',
    "overlay de rota tardio",
  );

  if (updated !== original) {
    write(filePath, updated);
  }
}

function overwriteUseTraccarDevicesChunk(filePath, mainAsset) {
  const source = `import { l as usePermissionGate, r as React, t as toDeviceKey, f as usePolling, s as safeApi, A as API_ROUTES } from "./${mainAsset}";

function normaliseDeviceList(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.devices)) return payload.devices;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function chunkList(values, size = 80) {
  if (!Array.isArray(values) || !values.length) return [];
  const chunkSize = Math.max(1, Number(size) || 80);
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function dedupeDevices(devices = []) {
  const deduped = new Map();
  (Array.isArray(devices) ? devices : []).forEach((device) => {
    const key = toDeviceKey(device?.id ?? device?.traccarId ?? device?.uniqueId);
    if (!key || deduped.has(String(key))) return;
    deduped.set(String(key), device);
  });
  return Array.from(deduped.values());
}

async function fetchDevices(deviceIds = []) {
  const batches = chunkList(deviceIds, 80);
  const targets = batches.length ? batches : [[]];
  const responses = await Promise.all(
    targets.map((batch) =>
      safeApi.get(API_ROUTES.devices, {
        params: {
          all: true,
          ...(batch.length ? { deviceIds: batch.join(",") } : {}),
        },
        suppressForbidden: true,
        forbiddenFallbackData: [],
      }),
    ),
  );
  const failed = responses.find((response) => response?.error);
  if (failed?.error) throw failed.error;
  return dedupeDevices(
    responses.flatMap((response) => normaliseDeviceList(response?.data)),
  );
}

function useTraccarDevices({ enabled = true, intervalMs = 15000, deviceIds = [] } = {}) {
  const hasAccess = usePermissionGate({ menuKey: "primary", pageKey: "devices", subKey: "devices-list" }).hasAccess;
  const normalizedIds = React.useMemo(
    () => (Array.isArray(deviceIds) ? deviceIds : [deviceIds]).map((value) => toDeviceKey(value)).filter(Boolean),
    [deviceIds],
  );
  const {
    data,
    loading,
    error,
    lastUpdated,
    refresh,
  } = usePolling(async () => {
    if (!hasAccess) return [];
    return fetchDevices(normalizedIds);
  }, {
    enabled: enabled && hasAccess,
    intervalMs,
    dependencies: [hasAccess, normalizedIds.join(",")],
  });

  const byId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((device) => {
      if (device?.id !== undefined && device?.id !== null) {
        map.set(String(device.id), device);
      }
    });
    return map;
  }, [data]);

  const byUniqueId = React.useMemo(() => {
    const map = new Map();
    (Array.isArray(data) ? data : []).forEach((device) => {
      if (device?.uniqueId) {
        map.set(String(device.uniqueId), device);
      }
    });
    return map;
  }, [data]);

  const resolveDevice = React.useCallback((vehicleOrDevice) => {
    const key = toDeviceKey(
      vehicleOrDevice?.device?.traccarId ??
        vehicleOrDevice?.device?.id ??
        vehicleOrDevice?.deviceId ??
        vehicleOrDevice?.device?.uniqueId ??
        vehicleOrDevice?.device?.unique_id ??
        vehicleOrDevice?.device_id,
    );
    return (key && (byId.get(key) || byUniqueId.get(key) || vehicleOrDevice?.device)) || null;
  }, [byId, byUniqueId]);

  const getDevicePosition = React.useCallback((vehicleOrDevice) => {
    const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
    return device?.lastPosition || device?.position || null;
  }, [resolveDevice]);

  const getDeviceStatus = React.useCallback((vehicleOrDevice, position) => {
    const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
    if (device?.status) return device.status;
    const timestamp = position?.serverTime || position?.deviceTime || position?.fixTime || device?.lastUpdate;
    if (!timestamp) return "Offline";
    const diffMs = Date.now() - new Date(timestamp).getTime();
    if (!Number.isFinite(diffMs)) return "Offline";
    if (diffMs <= 5 * 60 * 1000) return "Online";
    if (diffMs <= 60 * 60 * 1000) return "Ocioso";
    return "Offline";
  }, [resolveDevice]);

  const getDeviceLastSeen = React.useCallback((vehicleOrDevice, position) => {
    const device = resolveDevice(vehicleOrDevice) || vehicleOrDevice;
    const timestamp = position?.serverTime || position?.deviceTime || position?.fixTime || device?.lastUpdate;
    if (!timestamp) return "Sem comunicação";
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? "Sem comunicação" : parsed.toLocaleString();
  }, [resolveDevice]);

  const getDeviceCoordinates = React.useCallback((vehicleOrDevice, fallbackPosition) => {
    const position = fallbackPosition || getDevicePosition(vehicleOrDevice);
    const latitude = position?.latitude ?? position?.lat;
    const longitude = position?.longitude ?? position?.lon;
    return latitude === undefined || longitude === undefined || latitude === null || longitude === null
      ? "Sem posição"
      : \`\${latitude}, \${longitude}\`;
  }, [getDevicePosition]);

  return {
    devices: Array.isArray(data) ? data : [],
    byId,
    byUniqueId,
    loading,
    error,
    lastUpdated,
    refresh,
    getDevicePosition,
    getDeviceStatus,
    getDeviceLastSeen,
    getDeviceCoordinates,
  };
}

export { useTraccarDevices as u };
`;

  write(filePath, source);
}

function patchMirrorReceiversChunk(filePath) {
  const original = read(filePath);
  let updated = original;

  updated = updated.replace(
    ',{id:"history",label:"Histórico",permission:{menuKey:"admin",pageKey:"mirrors",subKey:"mirrors-main"}}',
    "",
  );
  updated = updated.replace("a&&(D(),E())", "a&&D()");
  updated = updated.replace("await Promise.all([D(),E()])", "await D()");

  if (updated !== original) {
    write(filePath, updated);
  }
}

function patchMapLayerSelectorChunk(filePath, search, replacement, label) {
  const original = read(filePath);
  const updated = replaceOnce(original, search, replacement, label);
  if (updated !== original) {
    write(filePath, updated);
  }
}

function main() {
  if (!fs.existsSync(assetsRoot)) {
    throw new Error(`assets ausente: ${assetsRoot}`);
  }

  const mainAsset = findAssetByPattern(/^index-.*\.js$/);
  const traccarHookAsset = findAssetByPattern(/^useTraccarDevices-.*\.js$/);
  const mirrorReceiversAsset = findAssetByPattern(/^MirrorReceivers-.*\.js$/);

  if (!mainAsset || !traccarHookAsset) {
    throw new Error(`Assets esperados ausentes: main=${mainAsset} useTraccarDevices=${traccarHookAsset}`);
  }

  patchMainMenuBundle(path.join(assetsRoot, mainAsset));
  overwriteUseTraccarDevicesChunk(path.join(assetsRoot, traccarHookAsset), mainAsset);
  patchLivePositionsWebSocket(path.join(assetsRoot, mainAsset));
  patchPermissionAndLoaderRuntime(path.join(assetsRoot, mainAsset));
  if (mirrorReceiversAsset) {
    patchMirrorReceiversChunk(path.join(assetsRoot, mirrorReceiversAsset));
  }
  const routesAsset = findAssetByPattern(/^Routes-.*\.js$/);
  if (routesAsset) {
    patchMapLayerSelectorChunk(
      path.join(assetsRoot, routesAsset),
      'wn=o.useMemo(()=>{const t=Vr.filter(l=>l==null?void 0:l.url),n=new Set,i=l=>{for(const x of l){const A=t.find(w=>w.key===x);if(A)return A}for(const x of l){const A=t.find(w=>w.key.includes(x));if(A)return A}return null},u=[{id:"satellite",label:"Satélite",layer:i(["mapbox-satellite","google-satellite","mapbox-hybrid","satellite","google-hybrid","hybrid"])},{id:"streets",label:"Ruas / Padrão",layer:i(["mapbox-light","mapbox-streets","google-road","openstreetmap","osm","carto-light"])},{id:"terrain",label:"Terreno",layer:i(["opentopomap","topo","terrain"])},{id:"dark",label:"Escuro",layer:i(["mapbox-dark","carto-dark","dark"])}].filter(l=>l.layer).filter(l=>!l.layer||n.has(l.layer.key)?!1:(n.add(l.layer.key),!0));return!u.length&&t.length?t.slice(0,5).map(l=>({id:l.key,label:l.label,layer:l})):u},[])',
      'wn=o.useMemo(()=>{const t=Vr.filter(l=>l==null?void 0:l.url);return t.map(l=>({id:l.key,label:l.label,layer:l}))},[])',
      "routes mapa completo",
    );
  }
  const geofencesAsset = findAssetByPattern(/^Geofences-.*\.js$/);
  if (geofencesAsset) {
    patchMapLayerSelectorChunk(
      path.join(assetsRoot, geofencesAsset),
      'Zn=s.useMemo(()=>{const e=vn.filter(o=>o==null?void 0:o.url),n=new Set,a=o=>{for(const g of o){const m=e.find(E=>E.key===g);if(m)return m}for(const g of o){const m=e.find(E=>E.key.includes(g));if(m)return m}return null},l=[{id:"satellite",label:"Satélite",layer:a(["mapbox-satellite","google-satellite","mapbox-hybrid","satellite","google-hybrid","hybrid"])},{id:"streets",label:"Ruas / Padrão",layer:a(["mapbox-light","mapbox-streets","google-road","openstreetmap","osm","carto-light"])},{id:"terrain",label:"Terreno",layer:a(["opentopomap","topo","terrain"])},{id:"dark",label:"Escuro",layer:a(["mapbox-dark","carto-dark","dark"])}].filter(o=>o.layer).filter(o=>!o.layer||n.has(o.layer.key)?!1:(n.add(o.layer.key),!0));return!l.length&&e.length?e.slice(0,5).map(o=>({id:o.key,label:o.label,layer:o})):l},[])',
      'Zn=s.useMemo(()=>{const e=vn.filter(o=>o==null?void 0:o.url);return e.map(o=>({id:o.key,label:o.label,layer:o}))},[])',
      "geofences mapa completo",
    );
  }
  const stockAsset = findAssetByPattern(/^Stock-.*\.js$/);
  if (stockAsset) {
    patchMapLayerSelectorChunk(
      path.join(assetsRoot, stockAsset),
      'mn=l.useMemo(()=>{const e=Ra.filter(o=>o==null?void 0:o.url),s=new Set,a=o=>{for(const r of o){const c=e.find(f=>f.key===r);if(c)return c}for(const r of o){const c=e.find(f=>f.key.includes(r));if(c)return c}return null},i=[{id:"satellite",label:"Satélite",layer:a(["mapbox-satellite","google-satellite","mapbox-hybrid","satellite","google-hybrid","hybrid"])},{id:"streets",label:"Ruas / Padrão",layer:a(["mapbox-light","mapbox-streets","google-road","openstreetmap","osm","carto-light"])},{id:"terrain",label:"Terreno",layer:a(["opentopomap","topo","terrain"])},{id:"dark",label:"Escuro",layer:a(["mapbox-dark","carto-dark","dark"])}].filter(o=>o.layer).filter(o=>!o.layer||s.has(o.layer.key)?!1:(s.add(o.layer.key),!0));return!i.length&&e.length?e.slice(0,5).map(o=>({id:o.key,label:o.label,layer:o})):i},[])',
      'mn=l.useMemo(()=>{const e=Ra.filter(o=>o==null?void 0:o.url);return e.map(o=>({id:o.key,label:o.label,layer:o}))},[])',
      "stock mapa completo",
    );
  }

  process.stdout.write("OK: ajustes de runtime 00h22 aplicados\n");
}

main();
