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
  },
};

export function useTranslation() {
  const locale = useUI((state) => state.locale) || "pt-BR";
  const dictionary = TRANSLATIONS[locale] || TRANSLATIONS["pt-BR"];
  return {
    t: (key) => dictionary[key] ?? TRANSLATIONS["pt-BR"][key] ?? key,
    locale,
  };
}
