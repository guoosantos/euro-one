import prisma from "../services/prisma.js";
import { listVehicles, getVehicleById } from "../models/vehicle.js";
import { listDevices } from "../models/device.js";
import {
  fetchLatestPositionsWithFallback,
  isTraccarDbConfigured,
} from "../services/traccar-db.js";

const failures = [];

function logResult(ok, message, details = {}) {
  const prefix = ok ? "✅" : "❌";
  console.log(`${prefix} ${message}`, Object.keys(details).length ? details : "");
}

async function main() {
  const vehicles = listVehicles();
  if (!vehicles.length) {
    failures.push("Nenhum veículo encontrado na fonte de dados.");
    logResult(false, "Lista de veículos vazia.");
  } else {
    logResult(true, "Lista de veículos retornou resultados.", { total: vehicles.length });
  }

  const sampleVehicle = vehicles[0];
  if (sampleVehicle) {
    const loaded = getVehicleById(sampleVehicle.id);
    if (!loaded) {
      failures.push("Falha ao carregar veículo listado pelo ID.");
      logResult(false, "GET /vehicles/:id falhou no carregamento interno.", { id: sampleVehicle.id });
    } else {
      logResult(true, "GET /vehicles/:id retornou veículo.", { id: sampleVehicle.id });
    }
  } else {
    failures.push("Nenhum veículo disponível para validar ID.");
    logResult(false, "Nenhum veículo disponível para validar ID.");
  }

  if (sampleVehicle) {
    const devices = listDevices();
    const linkedDevices = devices.filter(
      (device) => sampleVehicle && (device.vehicleId === sampleVehicle.id || device.id === sampleVehicle.deviceId),
    );

    if (!linkedDevices.length) {
      failures.push("Nenhum equipamento vinculado ao veículo de teste.");
      logResult(false, "Nenhum equipamento vinculado ao veículo de teste.", { vehicleId: sampleVehicle?.id });
    } else {
      logResult(true, "Equipamentos vinculados encontrados para o veículo de teste.", {
        vehicleId: sampleVehicle.id,
        devices: linkedDevices.length,
      });
    }

    const traccarIds = linkedDevices
      .map((device) => (device.traccarId != null ? String(device.traccarId) : null))
      .filter(Boolean);

    if (traccarIds.length && isTraccarDbConfigured()) {
      try {
        const positions = await fetchLatestPositionsWithFallback(traccarIds, null);
        if (positions?.length) {
          logResult(true, "Telemetria retornou posições para os equipamentos vinculados.", {
            queried: traccarIds.length,
            positions: positions.length,
          });
        } else {
          failures.push("Nenhuma posição retornada para equipamentos vinculados.");
          logResult(false, "Monitoramento não retornou posições.", { queried: traccarIds.length });
        }
      } catch (error) {
        failures.push("Falha ao consultar posições no Traccar.");
        logResult(false, "Erro ao consultar telemetria do Traccar.", { error: error?.message || error });
      }
    } else if (traccarIds.length === 0) {
      failures.push("Nenhum equipamento vinculado possui traccarId para validar posições.");
      logResult(false, "Nenhum equipamento vinculado possui traccarId para validar posições.", {
        vehicleId: sampleVehicle?.id,
      });
    } else {
      failures.push("Banco do Traccar não está configurado para validar posições.");
      logResult(false, "Banco do Traccar não está configurado para validar posições.");
    }
  }

  if (failures.length) {
    console.error("Healthcheck falhou:", failures);
    process.exitCode = 1;
  } else {
    console.log("Healthcheck concluído com sucesso.");
  }
}

// Garante que o Prisma inicializou (import do proxy já cuida disso)
await prisma.$connect?.().catch(() => {});
await main();
