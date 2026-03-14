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
  return fs
    .readdirSync(assetsRoot)
    .map((entry) => path.join(assetsRoot, entry))
    .find((filePath) => pattern.test(path.basename(filePath))) || null;
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search);
  if (index === -1) {
    if (source.includes(replacement)) return source;
    throw new Error(`Trecho não encontrado para ${label}`);
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function replaceAllLiteral(source, search, replacement) {
  if (!source.includes(search)) return source;
  return source.split(search).join(replacement);
}

function patchReportLabelsChunk(filePath) {
  let source = read(filePath);

  source = replaceOnce(
    source,
    "const O={",
    'const O={client:"Cliente",clientname:"Cliente",customer:"Cliente",customername:"Cliente",plate:"Placa",platelabel:"Placa",registrationnumber:"Placa",iotmreason:"Motivo",',
    "overrides pt-BR de labels base",
  );

  source = replaceOnce(
    source,
    'function R(e,s){if(!e)return s;const t=u(e).toLowerCase(),i=X[t];if(i)return i;const o=J(t,s);return o!==s?o:Q(t,s)||s}',
    'function R(e,s){if(!e)return null;const t=u(e).toLowerCase(),i=X[t];if(i)return i;const o=J(t,s);if(o!==s)return o;const r=Q(t,s);return r!==s?r:null}',
    "resolver IOTM sem fallback cru",
  );

  source = replaceOnce(
    source,
    'const $=[["client","customer","clientName"],["plate","vehiclePlate"],"ignition","deviceTime","serverTime","address","event","eventType","blocked",["iotmReason","reason","string1","io49152"],["input2Jammer","digitalInput2","input2","signalIn2","in2"],["geofences","geofence","geozoneId"],"speed",["geozoneInside","geofenceIds","statusItinerary"],["vehicleVoltage","voltage","power","externalPower"]];',
    'const $=[["client","customer","clientName"],["plate","vehiclePlate"],"ignition","deviceTime","serverTime","address","event","eventType","blocked","blockingModules","speed","geozoneInside","vehicleVoltage","batteryLevel","centralCommands"];',
    "ordem canônica de colunas do relatório",
  );

  source = replaceOnce(
    source,
    '{key:"iotmReason",labelPt:"Motivo",labelPdf:"Motivo",width:220,defaultVisible:!0,weight:1.8,group:"base"},{key:"input2Jammer",labelPt:"Módulos de Bloqueio",labelPdf:"Módulos de Bloqueio",width:180,defaultVisible:!0,weight:1.4,group:"base"},{key:"whoSent",labelPt:"Quem enviou",labelPdf:"Quem enviou",width:200,defaultVisible:!0,weight:1.6,group:"base"},{key:"handlingNotes",labelPt:"Tratativa",labelPdf:"Tratativa",width:220,defaultVisible:!1,weight:1.8,group:"actions"},{key:"handlingAuthor",labelPt:"Autor Tratativa",labelPdf:"Autor Tratativa",width:180,defaultVisible:!1,weight:1.4,group:"actions"},{key:"handlingAt",labelPt:"Data Tratativa",labelPdf:"Data Tratativa",width:160,defaultVisible:!1,weight:1.2,group:"actions",type:"date"},{key:"address",labelPt:"Endereço",labelPdf:"Endereço",width:280,defaultVisible:!0,weight:2.8,group:"base"},{key:"speed",labelPt:"Velocidade",labelPdf:"Velocidade",width:90,defaultVisible:!0,weight:.9,group:"base"},{key:"ignition",labelPt:"Ignição",labelPdf:"Ignição",width:90,defaultVisible:!0,weight:.9,group:"base",type:"boolean"},{key:"vehicleState",labelPt:"Status Veículo",labelPdf:"Status Veículo",width:150,defaultVisible:!0,weight:1.4,group:"base"},{key:"vehicleVoltage",labelPt:"Tensão do Veículo",labelPdf:"Tensão do Veículo",width:150,defaultVisible:!0,weight:1.3,group:"voltage",unit:"V",type:"number"},{key:"batteryLevel",labelPt:"Nível da Bateria",labelPdf:"Nível da Bateria",width:150,defaultVisible:!0,weight:1.3,group:"battery",unit:"%",type:"percent"}',
    '{key:"iotmReason",labelPt:"Motivo",labelPdf:"Motivo",width:220,defaultVisible:!0,weight:1.8,group:"base"},{key:"blockingModules",labelPt:"Módulos de Bloqueio",labelPdf:"Módulos de Bloqueio",width:210,defaultVisible:!0,weight:1.8,group:"base"},{key:"whoSent",labelPt:"Quem enviou",labelPdf:"Quem enviou",width:200,defaultVisible:!0,weight:1.6,group:"base"},{key:"handlingAuthor",labelPt:"Autor da tratativa",labelPdf:"Autor da tratativa",width:180,defaultVisible:!1,weight:1.4,group:"actions"},{key:"handlingAt",labelPt:"Data da tratativa",labelPdf:"Data da tratativa",width:160,defaultVisible:!1,weight:1.2,group:"actions",type:"date"},{key:"address",labelPt:"Endereço",labelPdf:"Endereço",width:280,defaultVisible:!0,weight:2.8,group:"base"},{key:"speed",labelPt:"Velocidade",labelPdf:"Velocidade",width:90,defaultVisible:!0,weight:.9,group:"base"},{key:"geozoneInside",labelPt:"Status Itinerário",labelPdf:"Status Itinerário",width:150,defaultVisible:!0,weight:1.2,group:"base",type:"boolean"},{key:"ignition",labelPt:"Ignição",labelPdf:"Ignição",width:90,defaultVisible:!0,weight:.9,group:"base",type:"boolean"},{key:"vehicleState",labelPt:"Status Veículo",labelPdf:"Status Veículo",width:150,defaultVisible:!0,weight:1.4,group:"base"},{key:"vehicleVoltage",labelPt:"Bateria do veículo",labelPdf:"Bateria do veículo",width:150,defaultVisible:!0,weight:1.3,group:"voltage",unit:"V",type:"number"},{key:"batteryLevel",labelPt:"Bateria do equipamento",labelPdf:"Bateria do equipamento",width:150,defaultVisible:!0,weight:1.3,group:"battery",unit:"V",type:"number"},{key:"centralCommands",labelPt:"Comandos",labelPdf:"Comandos",width:160,defaultVisible:!0,weight:1.2,group:"output",type:"boolean"}',
    "base canônica de colunas do relatório",
  );

  source = replaceAllLiteral(source, 'geofence:"Itinerário"', 'geofence:"Status Itinerário"');
  source = replaceAllLiteral(source, 'geozoneid:"Itinerário"', 'geozoneid:"Status Itinerário"');
  source = replaceAllLiteral(source, 'geozoneinside:"Dentro do Itinerário"', 'geozoneinside:"Status Itinerário"');
  source = replaceAllLiteral(source, 'geozoneinsideprimary:"Dentro do Itinerário"', 'geozoneinsideprimary:"Status Itinerário"');
  source = replaceAllLiteral(source, 'labelPt:"Dentro do Itinerário"', 'labelPt:"Status Itinerário"');
  source = replaceAllLiteral(source, 'label:"Itinerário",tooltip:"Itinerário"', 'label:"Status Itinerário",tooltip:"Status Itinerário"');
  source = replaceAllLiteral(source, 'label:"Dentro do Itinerário",tooltip:"Dentro do Itinerário"', 'label:"Status Itinerário",tooltip:"Status Itinerário"');
  source = replaceAllLiteral(source, 'label:"Tensão do Veículo",tooltip:"Tensão do Veículo"', 'label:"Bateria do veículo",tooltip:"Bateria do veículo"');
  source = replaceAllLiteral(source, 'label:"Nível da Bateria",tooltip:"Nível da Bateria"', 'label:"Bateria do equipamento",tooltip:"Bateria do equipamento"');
  source = replaceAllLiteral(source, 'label:"Bateria Dispositivo",tooltip:"Bateria Dispositivo"', 'label:"Bateria do equipamento",tooltip:"Bateria do equipamento"');
  source = replaceAllLiteral(source, 'gpsTime:{label:"Hora do Evento",tooltip:"Hora do Evento"}', 'gpsTime:{label:"Hora GPS",tooltip:"Hora GPS"}');
  source = replaceAllLiteral(source, 'occurredAt:{label:"Hora do Evento",tooltip:"Hora do Evento"}', 'occurredAt:{label:"Hora GPS",tooltip:"Hora GPS"}');
  source = replaceAllLiteral(source, 'accuracy:{label:"Altitude",tooltip:"Altitude"}', 'accuracy:{label:"Precisão",tooltip:"Precisão"}');
  source = replaceAllLiteral(source, 'valid:{label:"GPS com sinal válido",tooltip:"GPS com sinal válido"}', 'valid:{label:"Válido",tooltip:"Válido"}');
  source = replaceAllLiteral(source, 'motion:{label:"Veiculo Movimento",tooltip:"Veiculo Movimento"}', 'motion:{label:"Movimento",tooltip:"Movimento"}');
  source = replaceAllLiteral(source, 'vehiclevoltage:"Tensão do Veículo"', 'vehiclevoltage:"Bateria do veículo"');
  source = replaceAllLiteral(source, 'power:"Tensão do Veículo"', 'power:"Bateria do veículo"');
  source = replaceAllLiteral(source, 'externalpower:"Tensão do Veículo"', 'externalpower:"Bateria do veículo"');
  source = replaceAllLiteral(source, 'voltage:"Tensão do Veículo"', 'voltage:"Bateria do veículo"');
  source = replaceAllLiteral(source, 'batterylevel:"Nível da Bateria"', 'batterylevel:"Bateria do equipamento"');
  source = replaceAllLiteral(source, 'battery:"Bateria Dispositivo"', 'battery:"Bateria do equipamento"');
  source = replaceAllLiteral(source, 'batteryvoltage:"Bateria Dispositivo"', 'batteryvoltage:"Bateria do equipamento"');
  source = replaceAllLiteral(source, 'client:"client"', 'client:"Cliente"');
  source = replaceAllLiteral(source, 'clientname:"client"', 'clientname:"Cliente"');
  source = replaceAllLiteral(source, 'customer:"client"', 'customer:"Cliente"');
  source = replaceAllLiteral(source, 'customername:"client"', 'customername:"Cliente"');
  source = replaceAllLiteral(source, 'plate:"plate"', 'plate:"Placa"');
  source = replaceAllLiteral(source, 'platelabel:"plate"', 'platelabel:"Placa"');
  source = replaceAllLiteral(source, 'registrationnumber:"plate"', 'registrationnumber:"Placa"');
  source = replaceAllLiteral(source, 'iotmreason:"iotmReason"', 'iotmreason:"Motivo"');
  source = replaceAllLiteral(source, 'input2jammer:"Entrada 2"', 'input2jammer:"Módulos de Bloqueio"');
  source = replaceAllLiteral(source, 'input2Jammer:{label:"Entrada 2",tooltip:"Entrada 2"}', 'blockingModules:{label:"Módulos de Bloqueio",tooltip:"Módulos de Bloqueio"}');
  source = replaceAllLiteral(source, 'out1RouteDeviation:{label:"Status Itinerário",tooltip:"Status Itinerário"}', 'geozoneInside:{label:"Status Itinerário",tooltip:"Status Itinerário"}');
  source = replaceAllLiteral(source, 'out2CentralCommands:{label:"Comandos",tooltip:"Comandos"}', 'centralCommands:{label:"Comandos",tooltip:"Comandos"}');
  source = replaceAllLiteral(source, 'const m={gpsTime:{label:"Hora GPS",tooltip:"Hora GPS"}', 'const m={client:{label:"Cliente",tooltip:"Cliente"},plate:{label:"Placa",tooltip:"Placa"},gpsTime:{label:"Hora GPS",tooltip:"Hora GPS"}');
  source = replaceAllLiteral(source, 'ignition:{label:"Ignição",tooltip:"Ignição"},geofence:{label:"Status Itinerário",tooltip:"Status Itinerário"}', 'ignition:{label:"Ignição",tooltip:"Ignição"},uniqueId:{label:"Identificador",tooltip:"Identificador"},protocol:{label:"Protocolo",tooltip:"Protocolo"},geofence:{label:"Itinerario",tooltip:"Itinerario"}');
  source = replaceAllLiteral(source, 'geozoneId:{label:"Status Itinerário",tooltip:"Status Itinerário"}', 'geozoneId:{label:"Itinerario",tooltip:"Itinerario"}');
  source = replaceAllLiteral(source, 'batteryLevel:{label:"Bateria do equipamento",tooltip:"Bateria do equipamento"},event:{label:"Evento",tooltip:"Evento"}', 'batteryLevel:{label:"Bateria do equipamento",tooltip:"Bateria do equipamento"},blockingModules:{label:"Módulos de Bloqueio",tooltip:"Módulos de Bloqueio"},centralCommands:{label:"Comandos",tooltip:"Comandos"},mappedAttributes:{label:"Telemetria personalizada",tooltip:"Telemetria personalizada"},charge:{label:"Carga",tooltip:"Carga"},faceRecognition:{label:"Rec. Facial",tooltip:"Rec. Facial"},hours:{label:"Horas de motor",tooltip:"Horas de motor"},notes:{label:"Observações",tooltip:"Observações"},blockedReason:{label:"Motivo",tooltip:"Motivo"},handlingAuthor:{label:"Autor da tratativa",tooltip:"Autor da tratativa"},handlingAt:{label:"Data da tratativa",tooltip:"Data da tratativa"},event:{label:"Evento",tooltip:"Evento"}');
  source = replaceAllLiteral(source, 'rssi:{label:"Sinal Celular",tooltip:"Sinal Celular"}', 'rssi:{label:"Intensidade do Sinal Celular (RSSI em dBm)",tooltip:"Intensidade do Sinal Celular (RSSI em dBm)"}');
  source = replaceAllLiteral(source, 'direction:{label:"Direção em graus",tooltip:"Direção em graus"}', 'direction:{label:"Direção",tooltip:"Direção"}');
  source = replaceAllLiteral(source, 'distance:{label:"Distância",tooltip:"Distância"}', 'distance:{label:"Distância parcial",tooltip:"Distância parcial"}');
  source = replaceAllLiteral(source, 'totalDistance:{label:"Distância Total",tooltip:"Distância Total"}', 'totalDistance:{label:"Distância total",tooltip:"Distância total"}');
  source = replaceAllLiteral(source, 'gpstime:"Hora do Evento"', 'gpstime:"Hora GPS"');
  source = replaceAllLiteral(source, 'fixtime:"Hora do Evento"', 'fixtime:"Hora GPS"');
  source = replaceAllLiteral(source, 'accuracy:"Altitude"', 'accuracy:"Precisão"');
  source = replaceAllLiteral(source, 'precision:"Precisão GPS"', 'precision:"Precisão"');
  source = replaceAllLiteral(source, 'direction:"Direção em graus"', 'direction:"Direção"');
  source = replaceAllLiteral(source, 'geofence:"Status Itinerário"', 'geofence:"Itinerario"');
  source = replaceAllLiteral(source, 'geozoneid:"Status Itinerário"', 'geozoneid:"Itinerario"');
  source = replaceAllLiteral(source, 'motion:"Veiculo Movimento"', 'motion:"Movimento"');
  source = replaceAllLiteral(source, 'rssi:"Sinal Celular"', 'rssi:"Intensidade do Sinal Celular (RSSI em dBm)"');
  source = replaceAllLiteral(source, 'fixtime:{labelPt:"Hora do Evento",group:"base"}', 'fixtime:{labelPt:"Hora GPS",group:"base"}');
  source = replaceAllLiteral(source, 'valid:{labelPt:"GPS com sinal válido",type:"boolean",group:"base"}', 'valid:{labelPt:"Válido",type:"boolean",group:"base"}');
  source = replaceAllLiteral(source, 'course:{labelPt:"Direção em graus",group:"other"}', 'course:{labelPt:"Direção",group:"other"}');
  source = replaceAllLiteral(source, 'accuracy:{labelPt:"Altitude",unit:"m",type:"number",group:"sensor"}', 'accuracy:{labelPt:"Precisão",type:"number",group:"sensor"}');
  source = replaceAllLiteral(source, 'power:{labelPt:"Tensão do Veículo",unit:"V",type:"number",group:"voltage"}', 'power:{labelPt:"Bateria do veículo",unit:"V",type:"number",group:"voltage"}');
  source = replaceAllLiteral(source, 'battery:{labelPt:"Bateria Dispositivo",unit:"V",type:"number",group:"battery"}', 'battery:{labelPt:"Bateria do equipamento",unit:"V",type:"number",group:"battery"}');
  source = replaceAllLiteral(source, 'motion:{labelPt:"Veiculo Movimento",type:"boolean",group:"base"}', 'motion:{labelPt:"Movimento",type:"boolean",group:"base"}');
  source = replaceAllLiteral(source, 'distance:{labelPt:"Distância",unit:"km",type:"number",group:"other"}', 'distance:{labelPt:"Distância parcial",unit:"km",type:"number",group:"other"}');
  source = replaceAllLiteral(source, 'totaldistance:{labelPt:"Distância Total",unit:"km",type:"number",group:"other"}', 'totaldistance:{labelPt:"Distância total",unit:"km",type:"number",group:"other"}');
  source = replaceAllLiteral(source, 'hours:{labelPt:"Horas de Motor",unit:"h",type:"number",group:"other"}', 'hours:{labelPt:"Horas de motor",unit:"h",type:"number",group:"other"}');
  source = replaceAllLiteral(source, 'charge:{labelPt:"Carga da Bateria",type:"boolean",group:"battery"}', 'charge:{labelPt:"Carga",type:"boolean",group:"battery"}');
  source = replaceAllLiteral(source, 'batterylevel:{labelPt:"Nível da Bateria",unit:"%",type:"percent",group:"battery"}', 'batterylevel:{labelPt:"Bateria do equipamento",unit:"%",type:"percent",group:"battery"}');
  source = replaceAllLiteral(source, 'rssi:{labelPt:"Sinal Celular",group:"sensor"}', 'rssi:{labelPt:"Intensidade do Sinal Celular (RSSI em dBm)",group:"sensor"}');
  source = replaceAllLiteral(source, '{key:"deviceId",labelPt:"ID do dispositivo",labelPdf:"ID do dispositivo",width:150,defaultVisible:!0,weight:1.2,group:"base"},', '{key:"deviceId",labelPt:"Quantidade de Pontos",labelPdf:"Quantidade de Pontos",width:170,defaultVisible:!0,weight:1.3,group:"base"},');
  source = replaceAllLiteral(source, 'deviceId:{label:"ID do dispositivo",tooltip:"ID do dispositivo"},', 'deviceName:{label:"Equipamento",tooltip:"Equipamento"},deviceId:{label:"Quantidade de Pontos",tooltip:"Quantidade de Pontos"},');
  source = replaceAllLiteral(source, 'uniqueId:{label:"Identificador",tooltip:"Identificador"},protocol:{label:"Protocolo",tooltip:"Protocolo"}', 'deviceName:{label:"Equipamento",tooltip:"Equipamento"},deviceId:{label:"Quantidade de Pontos",tooltip:"Quantidade de Pontos"},uniqueId:{label:"Identificador",tooltip:"Identificador"},protocol:{label:"Protocolo",tooltip:"Protocolo"}');
  source = replaceAllLiteral(source, 'input2:{label:"Entrada 2",tooltip:"Entrada 2"},', '');
  source = replaceAllLiteral(source, 'in2:{label:"Entrada 2",tooltip:"Entrada 2"},', '');
  source = replaceAllLiteral(source, 'digitalInput2:{label:"Entrada 2",tooltip:"Entrada 2"},', '');
  source = replaceAllLiteral(source, 'input2Jammer:{label:"Entrada 2",tooltip:"Entrada 2"},', '');
  source = replaceAllLiteral(source, 'handlingAuthor:{label:"Autor Tratativa",tooltip:"Autor Tratativa"}', 'handlingAuthor:{label:"Autor da tratativa",tooltip:"Autor da tratativa"}');
  source = replaceAllLiteral(source, 'handlingAt:{label:"Data Tratativa",tooltip:"Data Tratativa"}', 'handlingAt:{label:"Data da tratativa",tooltip:"Data da tratativa"}');
  source = replaceAllLiteral(source, '{key:"gpsTime",labelPt:"Hora do Evento",labelPdf:"Hora do Evento"', '{key:"gpsTime",labelPt:"Hora GPS",labelPdf:"Hora GPS"');
  source = replaceAllLiteral(source, '{key:"rssi",labelPt:"Sinal Celular",labelPdf:"Sinal Celular"', '{key:"rssi",labelPt:"Intensidade do Sinal Celular (RSSI em dBm)",labelPdf:"Intensidade do Sinal Celular (RSSI em dBm)"');
  source = replaceAllLiteral(source, '{key:"hdop",labelPt:"Precisão GPS",labelPdf:"Precisão GPS"', '{key:"hdop",labelPt:"HDOP",labelPdf:"HDOP"');
  source = replaceAllLiteral(source, '{key:"accuracy",labelPt:"Altitude",labelPdf:"Altitude"', '{key:"accuracy",labelPt:"Precisão",labelPdf:"Precisão"');
  source = replaceAllLiteral(source, '{key:"distance",labelPt:"Distância",labelPdf:"Distância"', '{key:"distance",labelPt:"Distância parcial",labelPdf:"Distância parcial"');
  source = replaceAllLiteral(source, '{key:"totalDistance",labelPt:"Distância Total",labelPdf:"Distância Total"', '{key:"totalDistance",labelPt:"Distância total",labelPdf:"Distância total"');
  source = replaceAllLiteral(source, '{key:"direction",labelPt:"Direção em graus",labelPdf:"Direção em graus"', '{key:"direction",labelPt:"Direção",labelPdf:"Direção"');

  write(filePath, source);
}

function patchAnalyticChunk(filePath) {
  let source = read(filePath);

  source = replaceOnce(
    source,
    'v.length?ps(v,{protocol:Oe}).map(e).forEach(n=>{d.set(n.key,n)}):Tt.map(m=>e(m)).forEach(m=>{d.set(m.key,m)})',
    'a.length?a.map(m=>e(m)).forEach(m=>{d.set(m.key,m)}):v.length?ps(v,{protocol:Oe}).map(e).forEach(n=>{d.set(n.key,n)}):Tt.map(m=>e(m)).forEach(m=>{d.set(m.key,m)})',
    "analitico prioriza meta.columns",
  );

  source = replaceOnce(
    source,
    'const b=["client","plate","eventType","blocked","iotmReason","input2Jammer","whoSent","handlingNotes","handlingAuthor","handlingAt"];',
    'const b=["client","plate","eventType","blocked","blockingModules","whoSent","handlingAuthor","handlingAt"];',
    "required keys analítico canônicos",
  );

  source = replaceAllLiteral(
    source,
    'batteryLevel:Gs(e.batteryLevel),rssi:e.rssi??"—",satellites:e.satellites??"—",geofence:e.geofence||"—",accuracy:Ks(e.accuracy),',
    'batteryLevel:Gs(e.batteryLevel),geofence:e.geofence||"—",geozoneInside:e.geozoneInside??e.out1RouteDeviation??"—",centralCommands:e.centralCommands??e.out2CentralCommands??"—",rssi:e.rssi??"—",satellites:e.satellites??"—",blockingModules:e.blockingModules??e.input2Jammer??"—",itineraryStatusSeverity:e.itineraryStatusSeverity||null,accuracy:Ks(e.accuracy),',
  );

  source = replaceAllLiteral(
    source,
    'function Js(t){const s=Ft(t),i=Ss(s);return r.jsx("span",{className:`inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold leading-[14px] ${Ns(s)}`,children:i})}function Ft(t){if(t==null)return"Informativa";const s=String(t).trim();return!s||s==="-"||s==="—"?"Informativa":s}',
    'function Js(t){const s=Ft(t),i=Ss(s);return r.jsx("span",{className:`inline-flex items-center rounded-full border px-1.5 py-0 text-[9px] font-semibold leading-[14px] ${Ns(s)}`,children:i})}function ir(t,s){const i=typeof t=="string"?t.trim():"";return!i||i==="—"?"—":String(s||"").trim().toLowerCase()!=="warning"?i:r.jsx("span",{className:"inline-flex items-center rounded-full border border-orange-400/70 bg-orange-500/30 px-1.5 py-0 text-[9px] font-semibold leading-[14px] text-orange-50",children:i})}function Ft(t){if(t==null)return"Informativa";const s=String(t).trim();return!s||s==="-"||s==="—"?"Informativa":s}',
  );

  source = replaceAllLiteral(
    source,
    'render:e.key==="address"?o=>vt(o.address,o.lat,o.lng):["eventSeverity","criticality"].includes(e.key)?o=>Js(o[e.key]):e.key==="ignition"?o=>Xs(o.ignition):e.render',
    'render:e.key==="address"?o=>vt(o.address,o.lat,o.lng):e.key==="geozoneInside"?o=>ir(o.geozoneInside,o.itineraryStatusSeverity):["eventSeverity","criticality"].includes(e.key)?o=>Js(o[e.key]):e.key==="ignition"?o=>Xs(o.ignition):e.render',
  );
  source = replaceAllLiteral(source, 'deviceStatus:e.deviceStatus||"Dado não disponível"', 'deviceStatus:e.deviceStatus||"Offline"');
  source = replaceAllLiteral(source, 'blocked:e.blocked||"—"', 'blocked:e.blocked||"Não"');
  source = replaceAllLiteral(source, 'digitalInput1:j(e.digitalInput1),digitalInput2:j(e.digitalInput2),digitalOutput1:j(e.digitalOutput1),', 'digitalInput1:j(e.digitalInput1),digitalOutput1:j(e.digitalOutput1),');

  write(filePath, source);
}

function patchPositionsChunk(filePath) {
  let source = read(filePath);

  source = replaceOnce(
    source,
    'P.length?Nt(P,{protocol:se}).map(e=>{const a=Be(e,{protocol:se});return{...a,defaultVisible:a.defaultVisible??!0,width:a.width??Math.min(240,Math.max(120,a.label.length*7))}}):_e.map(r=>Be(r,{protocol:se}))',
    'Array.isArray(O==null?void 0:O.columns)&&O.columns.length?O.columns.map(e=>{const a=Be(e,{protocol:se});return{...a,defaultVisible:a.defaultVisible??!0,width:a.width??Math.min(240,Math.max(120,a.label.length*7))}}):P.length?Nt(P,{protocol:se}).map(e=>{const a=Be(e,{protocol:se});return{...a,defaultVisible:a.defaultVisible??!0,width:a.width??Math.min(240,Math.max(120,a.label.length*7))}}):_e.map(r=>Be(r,{protocol:se}))',
    "posicoes prioriza meta.columns",
  );

  source = replaceAllLiteral(
    source,
    'batteryLevel:Qt(e.batteryLevel),rssi:e.rssi??"—",satellites:e.satellites??"—",geofence:e.geofence||"—",accuracy:Kt(e.accuracy),',
    'batteryLevel:Qt(e.batteryLevel),geofence:e.geofence||"—",geozoneInside:e.geozoneInside??e.out1RouteDeviation??"—",centralCommands:e.centralCommands??e.out2CentralCommands??"—",rssi:e.rssi??"—",satellites:e.satellites??"—",blockingModules:e.blockingModules??e.input2Jammer??"—",itineraryStatusSeverity:e.itineraryStatusSeverity||null,accuracy:Kt(e.accuracy),',
  );

  source = replaceAllLiteral(
    source,
    'function Ht(t){const s=Yt(t),i=Dt(s);return o.jsx("span",{className:`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${Ot(s)}`,children:i})}function Yt(t){if(t==null)return"Informativa";const s=String(t).trim();return!s||s==="-"||s==="—"?"Informativa":s}',
    'function Ht(t){const s=Yt(t),i=Dt(s);return o.jsx("span",{className:`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${Ot(s)}`,children:i})}function ir(t,s){const i=typeof t=="string"?t.trim():"";return!i||i==="—"?"—":String(s||"").trim().toLowerCase()!=="warning"?i:o.jsx("span",{className:"inline-flex items-center rounded-full border border-orange-400/70 bg-orange-500/30 px-2 py-0.5 text-[11px] font-semibold text-orange-50",children:i})}function Yt(t){if(t==null)return"Informativa";const s=String(t).trim();return!s||s==="-"||s==="—"?"Informativa":s}',
  );

  source = replaceAllLiteral(
    source,
    'render:r.key==="address"?a=>kt(a.address,a.lat,a.lng):["eventSeverity","criticality"].includes(r.key)?a=>Ht(a[r.key]):r.render',
    'render:r.key==="address"?a=>kt(a.address,a.lat,a.lng):r.key==="geozoneInside"?a=>ir(a.geozoneInside,a.itineraryStatusSeverity):["eventSeverity","criticality"].includes(r.key)?a=>Ht(a[r.key]):r.render',
  );
  source = replaceAllLiteral(source, 'deviceStatus:e.deviceStatus||"Dado não disponível"', 'deviceStatus:e.deviceStatus||"Offline"');
  source = replaceAllLiteral(source, 'digitalInput1:h(e.digitalInput1),digitalInput2:h(e.digitalInput2),digitalOutput1:h(e.digitalOutput1),', 'digitalInput1:h(e.digitalInput1),digitalOutput1:h(e.digitalOutput1),');

  write(filePath, source);
}

function main() {
  const reportLabels = findAssetByPattern(/^report-column-labels-.*\.js$/);
  const reportsAnalytic = findAssetByPattern(/^ReportsAnalytic-.*\.js$/);
  const reportsPositions = findAssetByPattern(/^ReportsPositions-.*\.js$/);

  if (!reportLabels) throw new Error("chunk report-column-labels não encontrado");
  if (!reportsAnalytic) throw new Error("chunk ReportsAnalytic não encontrado");
  if (!reportsPositions) throw new Error("chunk ReportsPositions não encontrado");

  patchReportLabelsChunk(reportLabels);
  patchAnalyticChunk(reportsAnalytic);
  patchPositionsChunk(reportsPositions);

  process.stdout.write("OK: ajustes de relatórios 00h22 aplicados\n");
}

main();
