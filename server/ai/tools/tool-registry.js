import { TOOL_CATEGORIES, TOOL_CONFIRMATION_POLICY } from "../domain/tool-categories.js";

function toOperationalTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildCommunicationStatusSummary(status) {
  if (!status) return "Nao foi possivel confirmar a comunicacao.";
  if (status.status === "online") return `Comunicando normalmente (${status.minutesWithoutCommunication} min sem atraso relevante).`;
  if (status.status === "delayed") return `Comunicacao atrasada (${status.minutesWithoutCommunication} min sem atualizacao).`;
  if (status.status === "offline") return `Sem comunicacao recente (${status.minutesWithoutCommunication} min sem atualizacao).`;
  return "Status de comunicacao indefinido.";
}

function buildVehicleOutput({ vehicle, latestPosition, communicationStatus, ignition, devices, events, alerts }) {
  return {
    vehicle: vehicle
      ? {
          id: vehicle.id,
          plate: vehicle.plate || null,
          name: vehicle.name || null,
          label: vehicle.label || vehicle.name || vehicle.plate || vehicle.id,
          status: vehicle.status || null,
          group: vehicle.group || null,
          type: vehicle.type || null,
          clientId: vehicle.clientId || null,
        }
      : null,
    latestPosition: latestPosition
      ? {
          fixTime: toOperationalTime(latestPosition.fixTime || latestPosition.deviceTime || latestPosition.serverTime),
          latitude: latestPosition.latitude,
          longitude: latestPosition.longitude,
          speed: latestPosition.speed ?? null,
          address: latestPosition.fullAddress || latestPosition.address || null,
          protocol: latestPosition.protocol || null,
        }
      : null,
    communicationStatus: communicationStatus || null,
    ignition,
    devices: Array.isArray(devices)
      ? devices.map((device) => ({
          id: device.id,
          traccarId: device.traccarId || null,
          uniqueId: device.uniqueId || null,
          name: device.name || null,
        }))
      : [],
    events: Array.isArray(events)
      ? events.map((event) => ({
          id: event.id,
          type: event.type || null,
          eventTime: toOperationalTime(event.eventTime || event.serverTime),
        }))
      : [],
    alerts: Array.isArray(alerts)
      ? alerts.map((alert) => ({
          id: alert.id,
          eventType: alert.eventType || null,
          eventLabel: alert.eventLabel || null,
          severity: alert.severity || null,
          status: alert.status || null,
          createdAt: toOperationalTime(alert.createdAt),
        }))
      : [],
  };
}

function requireResolvedVehicle(resolved) {
  if (resolved?.vehicle) return resolved;
  const error = new Error("Veiculo nao encontrado ou fora do escopo autorizado.");
  error.status = 404;
  error.code = "VEHICLE_NOT_FOUND";
  throw error;
}

function buildPriorityRecommendation({ alerts = [], communicationStatus, ignition, events = [] }) {
  const criticalAlert = alerts.find((alert) => String(alert.severity || "").toLowerCase() === "critical");
  const warningAlert = alerts.find((alert) => ["high", "warning"].includes(String(alert.severity || "").toLowerCase()));
  const suspiciousIgnition = events.some((event) => /igni/i.test(String(event.type || "")));
  if (criticalAlert || communicationStatus?.status === "offline") {
    return {
      level: "alta",
      reason: "Ha sinal de indisponibilidade ou alerta critico pendente.",
    };
  }
  if (warningAlert || suspiciousIgnition || ignition === "unknown") {
    return {
      level: "media",
      reason: "Existe risco operacional moderado que merece validacao rapida.",
    };
  }
  return {
    level: "baixa",
    reason: "Nao ha indicio forte de criticidade com os dados confirmados.",
  };
}

function buildNextSteps({ communicationStatus, alerts = [], ignition, events = [] }) {
  const steps = [];
  if (communicationStatus?.status === "offline") {
    steps.push("Validar comunicacao do equipamento e disponibilidade do veiculo.");
  }
  if (alerts.some((alert) => String(alert.status || "").toLowerCase() === "pending")) {
    steps.push("Revisar alertas pendentes e registrar tratativa humana se aplicavel.");
  }
  if (ignition === "on") {
    steps.push("Confirmar se a ignicao ligada esta aderente ao contexto operacional esperado.");
  }
  if (events.length > 5) {
    steps.push("Revisar a sequencia de eventos recentes para identificar padrao repetitivo.");
  }
  if (!steps.length) {
    steps.push("Manter acompanhamento e registrar qualquer nova anomalia relevante.");
  }
  return steps;
}

export function createToolRegistry(runtime) {
  const readTools = [
    {
      name: "buscarVeiculoPorPlaca",
      category: TOOL_CATEGORIES.READ,
      description: "Busca um veiculo autorizado por placa e devolve dados basicos do cadastro operacional.",
      inputSchema: {
        type: "object",
        properties: {
          plate: { type: "string", description: "Placa do veiculo." },
        },
        required: ["plate"],
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle({ plate: input.plate }));
        return buildVehicleOutput({ vehicle: resolved.vehicle, devices: resolved.devices });
      },
    },
    {
      name: "buscarVeiculoPorId",
      category: TOOL_CATEGORIES.READ,
      description: "Busca um veiculo autorizado por identificador interno.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string", description: "ID interno do veiculo." },
        },
        required: ["vehicleId"],
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle({ vehicleId: input.vehicleId }));
        return buildVehicleOutput({ vehicle: resolved.vehicle, devices: resolved.devices });
      },
    },
    {
      name: "consultarUltimaPosicao",
      category: TOOL_CATEGORIES.READ,
      description: "Retorna a ultima posicao conhecida do veiculo em foco.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const communicationStatus = runtime.inferCommunicationStatus(resolved.latestPosition);
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          communicationStatus,
        });
      },
    },
    {
      name: "consultarStatusIgnicao",
      category: TOOL_CATEGORIES.READ,
      description: "Consulta o status mais recente de ignicao com base na ultima telemetria conhecida.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const ignition = runtime.getIgnitionFromPosition(resolved.latestPosition);
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          ignition,
        });
      },
    },
    {
      name: "consultarTelemetria",
      category: TOOL_CATEGORIES.READ,
      description: "Retorna telemetria recente do veiculo com foco em ultima posicao, ignicao e comunicacao.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const ignition = runtime.getIgnitionFromPosition(resolved.latestPosition);
        const communicationStatus = runtime.inferCommunicationStatus(resolved.latestPosition);
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          ignition,
          communicationStatus,
        });
      },
    },
    {
      name: "listarEventosRecentes",
      category: TOOL_CATEGORIES.READ,
      description: "Lista eventos recentes do veiculo em um periodo configuravel.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const events = await runtime.listVehicleEvents(resolved.vehicle, resolved.devices, {
          hours: input.hours,
          from: input.from,
          to: input.to,
          limit: input.limit,
        });
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          events,
        });
      },
    },
    {
      name: "consultarAlertasRelacionados",
      category: TOOL_CATEGORIES.READ,
      description: "Lista alertas relacionados ao veiculo no escopo autorizado.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          status: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const alerts = runtime.listVehicleAlerts(resolved.vehicle.id, { status: input.status });
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          alerts,
        });
      },
    },
    {
      name: "consultarStatusComunicacao",
      category: TOOL_CATEGORIES.READ,
      description: "Determina se o equipamento do veiculo esta comunicando normalmente.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const communicationStatus = runtime.inferCommunicationStatus(resolved.latestPosition);
        return {
          ...buildVehicleOutput({
            vehicle: resolved.vehicle,
            devices: resolved.devices,
            latestPosition: resolved.latestPosition,
            communicationStatus,
          }),
          summary: buildCommunicationStatusSummary(communicationStatus),
        };
      },
    },
    {
      name: "consultarDadosDeTrajeto",
      category: TOOL_CATEGORIES.READ,
      description: "Retorna um recorte operacional das ultimas horas para apoiar investigacao do trajeto.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const range = runtime.resolveTimeRange({ hours: input.hours, from: input.from, to: input.to });
        const events = await runtime.listVehicleEvents(resolved.vehicle, resolved.devices, {
          hours: input.hours,
          from: input.from,
          to: input.to,
          limit: 20,
        });
        const alerts = runtime.listVehicleAlerts(resolved.vehicle.id, range);
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          events,
          alerts,
        });
      },
    },
    {
      name: "consultarResumoOperacional",
      category: TOOL_CATEGORIES.READ,
      description: "Consolida status atual, comunicacao, ignicao, eventos e alertas do veiculo.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const range = runtime.resolveTimeRange({ hours: input.hours, from: input.from, to: input.to });
        const events = await runtime.listVehicleEvents(resolved.vehicle, resolved.devices, {
          hours: input.hours,
          from: input.from,
          to: input.to,
          limit: 10,
        });
        const alerts = runtime.listVehicleAlerts(resolved.vehicle.id, range);
        const ignition = runtime.getIgnitionFromPosition(resolved.latestPosition);
        const communicationStatus = runtime.inferCommunicationStatus(resolved.latestPosition);
        const nextSteps = buildNextSteps({ communicationStatus, alerts, ignition, events });
        return {
          ...buildVehicleOutput({
            vehicle: resolved.vehicle,
            devices: resolved.devices,
            latestPosition: resolved.latestPosition,
            communicationStatus,
            ignition,
            events,
            alerts,
          }),
          nextSteps,
        };
      },
    },
    {
      name: "consultarResumoDeOcorrencia",
      category: TOOL_CATEGORIES.READ,
      description: "Consolida a ocorrencia atual usando alertas e eventos recentes do veiculo.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          alertStatus: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        const alerts = runtime.listVehicleAlerts(resolved.vehicle.id, { status: input.alertStatus });
        const events = await runtime.listVehicleEvents(resolved.vehicle, resolved.devices, { hours: 12, limit: 10 });
        return buildVehicleOutput({
          vehicle: resolved.vehicle,
          devices: resolved.devices,
          latestPosition: resolved.latestPosition,
          alerts,
          events,
        });
      },
    },
  ];

  const assistTools = [
    {
      name: "gerarResumoOperacional",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Gera um resumo operacional objetivo baseado em dados confirmados do veiculo.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
          from: { type: "string" },
          to: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const summary = await readTools.find((tool) => tool.name === "consultarResumoOperacional").execute(input);
        const communicationSummary = buildCommunicationStatusSummary(summary.communicationStatus);
        return {
          ...summary,
          generatedSummary: [
            `Veiculo: ${summary.vehicle?.label || "nao confirmado"}.`,
            summary.latestPosition?.fixTime
              ? `Ultima posicao confirmada em ${summary.latestPosition.fixTime}${summary.latestPosition.address ? `, ${summary.latestPosition.address}` : ""}.`
              : "Ultima posicao nao confirmada.",
            `Ignicao: ${summary.ignition || "desconhecida"}.`,
            communicationSummary,
            summary.alerts?.length ? `Alertas relacionados: ${summary.alerts.length}.` : "Sem alertas relacionados confirmados.",
          ].join(" "),
        };
      },
    },
    {
      name: "gerarResumoDeEvento",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Resume o ultimo evento relevante do veiculo e seu impacto operacional.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const result = await readTools.find((tool) => tool.name === "listarEventosRecentes").execute({ ...input, limit: 5, hours: 6 });
        const latestEvent = result.events?.[0] || null;
        return {
          ...result,
          generatedSummary: latestEvent
            ? `Ultimo evento confirmado: ${latestEvent.type || "sem tipo"} em ${latestEvent.eventTime || "horario nao confirmado"}.`
            : "Nao foi possivel confirmar evento recente para o veiculo informado.",
        };
      },
    },
    {
      name: "sugerirPrioridadeDeAtendimento",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Sugere prioridade operacional com base em alertas, comunicacao, ignicao e eventos.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const summary = await readTools.find((tool) => tool.name === "consultarResumoOperacional").execute(input);
        const recommendation = buildPriorityRecommendation(summary);
        return {
          ...summary,
          recommendation,
        };
      },
    },
    {
      name: "analisarPossivelDesvio",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Avalia se ha indicio operacional de desvio com base em eventos e alertas recentes.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const result = await readTools.find((tool) => tool.name === "consultarDadosDeTrajeto").execute(input);
        const suspicious = result.events?.some((event) => /route|itinerary|geofence|desvio/i.test(String(event.type || ""))) ||
          result.alerts?.some((alert) => /rota|desvio|itiner/i.test(String(alert.eventLabel || alert.eventType || "")));
        return {
          ...result,
          analysis: suspicious
            ? "Ha indicio operacional que merece verificacao de possivel desvio."
            : "Nao ha indicio forte de desvio nos dados confirmados do periodo analisado.",
        };
      },
    },
    {
      name: "analisarMudancaSuspeitaDeIgnicao",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Analisa mudancas suspeitas de ignicao a partir de eventos e telemetria recente.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          hours: { type: "number" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const result = await readTools.find((tool) => tool.name === "listarEventosRecentes").execute({ ...input, hours: input.hours || 6, limit: 15 });
        const ignitionEvents = result.events?.filter((event) => /igni|engine|motion/i.test(String(event.type || ""))) || [];
        return {
          ...result,
          analysis: ignitionEvents.length >= 3
            ? "Ha variacao frequente de eventos relacionados a ignicao/movimento. Recomenda-se validacao operacional."
            : "Nao ha sinal forte de mudanca suspeita de ignicao no periodo analisado.",
        };
      },
    },
    {
      name: "prepararResumoParaRepasseOperacional",
      category: TOOL_CATEGORIES.ASSIST,
      description: "Prepara um texto curto para repasse operacional baseado em fatos confirmados.",
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const summary = await assistTools.find((tool) => tool.name === "gerarResumoOperacional").execute(input);
        const priority = await assistTools.find((tool) => tool.name === "sugerirPrioridadeDeAtendimento").execute(input);
        return {
          ...summary,
          relaySummary: [
            `Repasse operacional: ${summary.generatedSummary}`,
            `Prioridade sugerida: ${priority.recommendation?.level || "nao definida"} - ${priority.recommendation?.reason || "sem justificativa adicional"}.`,
          ].join(" "),
        };
      },
    },
  ];

  const actionTools = [
    {
      name: "abrirOcorrenciaInterna",
      category: TOOL_CATEGORIES.ACTION_REQUEST,
      description: "Prepara uma solicitacao estruturada para abertura de ocorrencia interna, sem executar a acao.",
      confirmationPolicy: TOOL_CONFIRMATION_POLICY.HUMAN_CONFIRMATION_REQUIRED,
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const resolved = requireResolvedVehicle(await runtime.resolveVehicle(input));
        return {
          action: "abrirOcorrenciaInterna",
          executionStatus: "not-executed",
          requiresHumanConfirmation: true,
          requestDraft: {
            vehicleId: resolved.vehicle.id,
            plate: resolved.vehicle.plate || null,
            reason: input.reason || "Ocorrencia sugerida pela camada operacional de IA.",
          },
        };
      },
    },
    {
      name: "sugerirEscalonamento",
      category: TOOL_CATEGORIES.ACTION_REQUEST,
      description: "Sugere um fluxo de escalonamento humano sem executar nenhuma acao no sistema.",
      confirmationPolicy: TOOL_CONFIRMATION_POLICY.HUMAN_CONFIRMATION_REQUIRED,
      inputSchema: {
        type: "object",
        properties: {
          vehicleId: { type: "string" },
          plate: { type: "string" },
        },
        additionalProperties: false,
      },
      async execute(input) {
        const priority = await assistTools.find((tool) => tool.name === "sugerirPrioridadeDeAtendimento").execute(input);
        return {
          action: "sugerirEscalonamento",
          executionStatus: "not-executed",
          requiresHumanConfirmation: true,
          recommendation: {
            level: priority.recommendation?.level || "media",
            destination:
              priority.recommendation?.level === "alta" ? "central operacional / supervisor" : "fila operacional padrao",
            reason: priority.recommendation?.reason || "Escalonamento sugerido pela analise operacional.",
          },
        };
      },
    },
  ];

  return [...readTools, ...assistTools, ...actionTools];
}
