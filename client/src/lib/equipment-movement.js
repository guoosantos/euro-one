function normalizeMovementType(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MOVEMENT_LABELS = {
  "service-request-transfer-migration": "Transferência (via OS)",
  "service-request-transfer": "Transferência",
  "stock-transfer": "Transferência de estoque",
  "vehicle-linked": "Vinculado ao veículo",
  "vehicle-unlinked": "Retirado do veículo",
  installation: "Instalação",
  uninstall: "Retirada",
  returned: "Devolução",
  returned_to_base: "Devolução para base",
  base_maintenance: "Envio para manutenção",
  base_return: "Retorno para base",
  linked: "Vinculado ao veículo",
  unlinked: "Desvinculado do veículo",
  created: "Cadastro do equipamento",
  updated: "Atualização de cadastro",
  condition_change: "Alteração de condição",
  service_order_created: "OS criada",
  service_order_linked: "OS vinculada",
  service_order_completed: "OS concluída",
};

export function resolveEquipmentMovementMeta(type) {
  const code = normalizeMovementType(type);
  if (!code) {
    return { code: "", label: "Movimentação", known: false };
  }
  const label = MOVEMENT_LABELS[code] || null;
  if (label) {
    return { code, label, known: true };
  }
  return { code, label: "Movimentação", known: false };
}

export function resolveEquipmentMovementLabel(type) {
  return resolveEquipmentMovementMeta(type).label;
}
