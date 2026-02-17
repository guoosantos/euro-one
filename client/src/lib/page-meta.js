import { matchPath, useLocation } from "react-router-dom";
import { useMemo } from "react";

const META = {
  "/dashboard": {
    title: "Operação ao vivo",
    kicker: "Dashboard",
    subtitle: "Arraste, redimensione e salve sua visão. Preferências ficam atreladas ao seu perfil e tenant.",
  },
  "/home": { title: "Visão geral" },
  "/monitoring": { title: "Monitoramento" },
  "/monitoramento": { title: "Mapa em tempo real" },
  "/trips": { title: "Trajetos" },
  "/routes": { title: "Rotas" },
  "/rotas": { title: "Rotas" },
  "/devices": { title: "Equipamentos", subtitle: "Gestão, vínculo e status dos equipamentos." },
  "/devices/new": { title: "Novo equipamento", subtitle: "Cadastro completo do equipamento." },
  "/devices/:id/edit": { title: "Editar equipamento", subtitle: "Dados gerais, vínculos e telemetria." },
  "/devices/:id/editar": { title: "Editar equipamento", subtitle: "Dados gerais, vínculos e telemetria." },
  "/equipamentos": { title: "Equipamentos", subtitle: "Gestão, vínculo e status dos equipamentos." },
  "/equipamentos/new": { title: "Novo equipamento", subtitle: "Cadastro completo do equipamento." },
  "/equipamentos/:id/edit": { title: "Editar equipamento", subtitle: "Dados gerais, vínculos e telemetria." },
  "/equipamentos/:id/editar": { title: "Editar equipamento", subtitle: "Dados gerais, vínculos e telemetria." },
  "/devices/chips": { title: "Chips", subtitle: "Gerencie chips ativos, vínculos e informações de conectividade." },
  "/chips": { title: "Chips", subtitle: "Gerencie chips ativos, vínculos e informações de conectividade." },
  "/devices/products": { title: "Modelos & Portas", subtitle: "Cadastre modelos e configurações de portas/protocolos." },
  "/devices/stock": { title: "Estoque", subtitle: "Controle por cliente, disponíveis e vinculados." },
  "/devices/import": {
    title: "Importar dispositivos",
    subtitle: "Associe dispositivos já existentes no Traccar a um cliente do Euro One.",
  },
  "/commands": {
    title: "Comandos",
    subtitle: "Envie comandos aos veículos, personalize preferências e acompanhe o histórico.",
  },
  "/commands/create": {
    title: "Criar Comandos",
    subtitle: "Cadastre comandos RAW para aparecerem na central de comandos conforme o protocolo selecionado.",
  },
  "/vehicles": { title: "Veículos", subtitle: "Frota e dados principais." },
  "/vehicles/:id": { title: "Veículo" },
  "/veiculos": { title: "Veículos", subtitle: "Frota e dados principais." },
  "/veiculos/:id": { title: "Veículo" },
  "/groups": { title: "Grupos", subtitle: "Sincronizados diretamente com o Traccar." },
  "/drivers": { title: "Motoristas", subtitle: "Lista proveniente do cadastro do Traccar." },
  "/documents": { title: "Documentos" },
  "/services": { title: "Ordem de Serviço", subtitle: "Solicitações, execução e aprovação das OS." },
  "/services/new": { title: "Nova Ordem de Serviço", subtitle: "Solicite o serviço e acompanhe o status." },
  "/services/import": {
    title: "Importar base (XLSX)",
    subtitle: "Use o XLSX consolidado para popular veículos, equipamentos e OS.",
  },
  "/services/:id": { title: "Detalhes da OS" },
  "/services/:id/execute": { title: "Execução da OS" },
  "/service-requests": {
    title: "Solicitações",
    subtitle: "Gestão operacional com cliente, veículo e janela de atendimento por solicitação.",
  },
  "/appointments": {
    title: "Agendamentos",
    subtitle: "Gestão operacional com janela, responsável e status por agendamento.",
  },
  "/var": {
    title: "Auditoria do Serviço",
    subtitle: "Auditoria operacional com status e técnico para acompanhamento dos atendimentos.",
  },
  "/deliveries": { title: "Entregas" },
  "/tasks": { title: "Tasks" },
  "/tasks/new": { title: "Nova task" },
  "/tasks/:id": { title: "Detalhes da task" },
  "/geofences": { title: "Cercas" },
  "/cercas": { title: "Cercas" },
  "/targets": { title: "Alvos" },
  "/alvos": { title: "Alvos" },
  "/itineraries": { title: "Embarcar Itinerários" },
  "/events": { title: "Eventos", subtitle: "Monitore protocolos, personalize severidades e extraia relatórios." },
  "/conditional-actions": {
    title: "Ação Condicional",
    subtitle: "Configure regras IF/THEN por escopo de veículos/equipamentos e acompanhe a auditoria de disparos.",
  },
  "/videos": { title: "Vídeos" },
  "/face": {
    title: "Reconhecimento facial e cabine",
    subtitle:
      "Alertas provenientes das câmeras embarcadas Euro Vision (fadiga, distração, uso de cinto). Atualização contínua.",
  },
  "/live": {
    title: "Streams ao vivo",
    subtitle:
      "Inicie e acompanhe streams ao vivo JT/T 1078 dos dispositivos NT407 conectados ao listener do Euro One.",
  },
  "/fatigue": {
    title: "Sensor de Fadiga",
    subtitle: "Eventos de sonolência/distração com severidade, score e vínculo de vídeo por dispositivo e período.",
  },
  "/ranking": { title: "Ranking" },
  "/analytics/heatmap": {
    title: "Mapa de calor",
    kicker: "Analytics",
  },
  "/analytics/risk-area": {
    title: "Área de Risco",
    kicker: "Análises",
    subtitle: "Visualize as áreas de risco associadas aos veículos autorizados.",
  },
  "/analytics/security": {
    title: "Segurança",
    kicker: "Análises",
    subtitle: "Área dedicada a análises e indicadores de segurança.",
  },
  "/reports/positions": { title: "Relatório de posições" },
  "/reports/analytic": { title: "Relatório Analítico" },
  "/account": { title: "Conta" },
  "/settings": { title: "Configurações", subtitle: "Ajuste preferências de telemetria e personalização da interface." },
  "/notifications": {
    title: "Notificações",
    subtitle: "Monitoramento contínuo das regras de alerta do Traccar.",
  },
  "/clients": {
    title: "Clientes",
    subtitle: "Cadastre, acompanhe limites e gerencie as informações dos clientes.",
  },
  "/clients/:id": { title: "Detalhes do cliente" },
  "/mirrors/received": { title: "Espelhamento", subtitle: "Gerencie os espelhamentos ativos entre clientes." },
  "/users": { title: "Usuários", subtitle: "Cadastre operadores, defina grupos e regras avançadas de acesso." },
  "/technicians": {
    title: "Técnico",
    subtitle: "Cadastre e gerencie técnicos disponíveis para ordens de serviço.",
  },
  "/crm": {
    title: "CRM",
    subtitle: "Cadastre clientes, acompanhe contratos e registre interações.",
  },
  "/crm/:section": {
    title: "CRM",
    subtitle: "Cadastre clientes, acompanhe contratos e registre interações.",
  },
  "/finance": { title: "Financeiro", subtitle: "Entradas, saídas e OS aprovadas." },
  "/driver-behavior": {
    title: "Drive Behavior",
    subtitle: "Em desenvolvimento — módulo de comportamento de motoristas.",
  },
  "/maintenance": {
    title: "Manutenção",
    subtitle: "Em desenvolvimento — módulo de manutenção preventiva e corretiva.",
  },
  "/fuel": {
    title: "Combustível",
    subtitle: "Em desenvolvimento — módulo de combustível e abastecimentos.",
  },
  "/routing": {
    title: "Roteirização",
    subtitle: "Em desenvolvimento — módulo de otimização e despacho de rotas.",
  },
  "/compliance": {
    title: "Compliance",
    subtitle: "Em desenvolvimento — módulo de conformidade operacional.",
  },
  "/iot-sensors": { title: "Sensores IoT", subtitle: "Em desenvolvimento — módulo de sensores IoT." },
  "/video-telematics": {
    title: "Vídeo Telemetria",
    subtitle: "Em desenvolvimento — módulo de vídeo telemetria e câmeras.",
  },
  "/admin/import-euro-xlsx": { title: "Importar Base (XLSX)" },
  "/reports": { title: "Relatórios", subtitle: "Selecione o veículo e o período para gerar relatórios detalhados." },
  "/reports/summary": {
    title: "Resumo de relatórios",
    subtitle: "Métricas agregadas de velocidade, distância e tempo em movimento.",
  },
  "/reports/route": {
    title: "Relatório de rotas",
    subtitle: "Extrai todos os pontos percorridos no intervalo informado.",
  },
  "/reports/stops": {
    title: "Relatório de paradas",
    subtitle: "Identifica os locais onde o veículo permaneceu estacionado.",
  },
};

export const PAGE_META = Object.entries(META).map(([path, meta]) => ({
  path,
  ...meta,
}));

export function resolvePageMeta(pathname) {
  if (!pathname) return null;
  for (const meta of PAGE_META) {
    if (matchPath({ path: meta.path, end: true }, pathname)) {
      return meta;
    }
  }
  return null;
}

export function getPageMetaByPath(path) {
  return META[path] || null;
}

export function usePageMeta() {
  const location = useLocation();

  return useMemo(() => resolvePageMeta(location.pathname), [location.pathname]);
}
