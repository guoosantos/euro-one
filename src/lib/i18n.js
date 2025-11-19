import { useUI } from "./store";

const TRANSLATIONS = {
  "pt-BR": {
    dashboard: "Dashboard",
    liveStreams: "Streams ao vivo",
    addManualStream: "Adicionar stream manual",
    reports: "Relatórios",
    generateReport: "Gerar relatório",
    exportCsv: "Exportar CSV",
    loginTitle: "Acesse o Euro One",
    username: "Usuário",
    password: "Senha",
    rememberMe: "Manter sessão ativa",
    analyticsHeatmap: "Analytics – Mapa de calor",
    analyticsHeatmapDescription: "Visualize as zonas com maior concentração de eventos.",
    from: "De",
    to: "Até",
    eventType: "Tipo de evento",
    eventTypePlaceholder: "ex.: alarm, ignitionOn",
    loading: "Carregando...",
    refresh: "Atualizar",
    topZones: "Top 10 zonas",
    topZonesHint: "Agrupado por coordenadas",
    pointsPlotted: "Pontos plotados: {count}",
    eventsCount: "Eventos: {count}",
    noData: "Sem dados para o período",
    eventsInZone: "{count} eventos",
  },
  "en-US": {
    dashboard: "Dashboard",
    liveStreams: "Live streams",
    addManualStream: "Add manual stream",
    reports: "Reports",
    generateReport: "Generate report",
    exportCsv: "Export CSV",
    loginTitle: "Sign in to Euro One",
    username: "Username",
    password: "Password",
    rememberMe: "Keep me signed in",
    analyticsHeatmap: "Analytics – Heatmap",
    analyticsHeatmapDescription: "See where events concentrate across your fleet.",
    from: "From",
    to: "To",
    eventType: "Event type",
    eventTypePlaceholder: "e.g. alarm, ignitionOn",
    loading: "Loading...",
    refresh: "Refresh",
    topZones: "Top 10 zones",
    topZonesHint: "Grouped by coordinates",
    pointsPlotted: "Plotted points: {count}",
    eventsCount: "Events: {count}",
    noData: "No data for the period",
    eventsInZone: "{count} events",
  },
};

export function useTranslation() {
  const locale = useUI((state) => state.locale) || "pt-BR";
  const dictionary = TRANSLATIONS[locale] || TRANSLATIONS["pt-BR"];
  return {
    t: (key, replacements = null) => {
      const template = dictionary[key] ?? TRANSLATIONS["pt-BR"][key] ?? key;
      if (!replacements) return template;
      return Object.entries(replacements).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        template,
      );
    },
    locale,
  };
}
