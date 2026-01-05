export const iotmEventCatalog = [
  {
    id: "1",
    labelPt: "Ignição ligada",
    severity: "info",
    description: "Ignição do veículo foi ligada.",
  },
  {
    id: "2",
    labelPt: "Ignição desligada",
    severity: "info",
    description: "Ignição do veículo foi desligada.",
  },
  {
    id: "3",
    labelPt: "Alimentação ligada",
    severity: "info",
    description: "Dispositivo recebeu alimentação externa.",
  },
  {
    id: "4",
    labelPt: "Alimentação desligada",
    severity: "warning",
    description: "Alimentação externa removida do dispositivo.",
  },
  {
    id: "5",
    labelPt: "Velocidade excedida",
    severity: "warning",
    description: "Limite de velocidade configurado foi excedido.",
  },
  {
    id: "6",
    labelPt: "Bateria baixa",
    severity: "warning",
    description: "Nível de bateria do dispositivo está baixo.",
  },
  {
    id: "7",
    labelPt: "Movimento detectado",
    severity: "info",
    description: "Movimento identificado pelo sensor do dispositivo.",
  },
  {
    id: "8",
    labelPt: "Parado",
    severity: "info",
    description: "Dispositivo reportou condição de parado.",
  },
  {
    id: "9",
    labelPt: "Jamming GSM",
    severity: "critical",
    description: "Interferência GSM detectada.",
  },
  {
    id: "10",
    labelPt: "Jamming GPS",
    severity: "critical",
    description: "Interferência GPS detectada.",
  },
  {
    id: "11",
    labelPt: "Entrada em geocerca",
    severity: "info",
    description: "Veículo entrou na geocerca configurada.",
  },
  {
    id: "12",
    labelPt: "Saída de geocerca",
    severity: "info",
    description: "Veículo saiu da geocerca configurada.",
  },
  {
    id: "13",
    labelPt: "Violação de geocerca",
    severity: "warning",
    description: "Evento de violação de geocerca registrado.",
  },
  {
    id: "14",
    labelPt: "Reboque detectado",
    severity: "warning",
    description: "Movimento anormal (possível reboque) detectado.",
  },
  {
    id: "15",
    labelPt: "Dispositivo desconectado",
    severity: "warning",
    description: "O dispositivo ficou sem comunicação.",
  },
];

export default iotmEventCatalog;
