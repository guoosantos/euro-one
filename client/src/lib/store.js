import { create } from "zustand";

const STORAGE_KEY = "euro-one.ui";

function loadState() {
  try {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn("Failed to load UI state", error);
    return {};
  }
}

function persistState(state) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Failed to persist UI state", error);
  }
}

const initialState = {
  sidebarOpen: false,
  sidebarCollapsed: false,
  theme: "dark",
  locale: "pt-BR",
  monitoringTopbarVisible: true,
  ...loadState(),
};

function persistNextState(nextState) {
  persistState({
    theme: nextState.theme,
    locale: nextState.locale,
    sidebarCollapsed: nextState.sidebarCollapsed,
    monitoringTopbarVisible: nextState.monitoringTopbarVisible,
  });
}

export const useUI = create((set, get) => ({
  ...initialState,
  toggle: () =>
    set((state) => {
      const next = { ...state, sidebarOpen: !state.sidebarOpen };
      persistNextState(next);
      return next;
    }),
  setTheme: (theme) => {
    set((state) => {
      const nextTheme = theme || state.theme;
      const next = { ...state, theme: nextTheme };
      persistNextState(next);
      if (typeof document !== "undefined") {
        document.documentElement.dataset.theme = nextTheme;
      }
      return next;
    });
  },
  toggleTheme: () => {
    const nextTheme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(nextTheme);
  },
  setLocale: (locale) => {
    set((state) => {
      const nextLocale = locale || state.locale;
      const next = { ...state, locale: nextLocale };
      persistNextState(next);
      if (typeof document !== "undefined") {
        document.documentElement.lang = nextLocale;
      }
      return next;
    });
  },
  toggleSidebarCollapsed: () =>
    set((state) => {
      const next = { ...state, sidebarCollapsed: !state.sidebarCollapsed };
      persistNextState(next);
      return next;
    }),
  setSidebarCollapsed: (collapsed) =>
    set((state) => {
      const value = typeof collapsed === "boolean" ? collapsed : state.sidebarCollapsed;
      const next = { ...state, sidebarCollapsed: value };
      persistNextState(next);
      return next;
    }),
  setMonitoringTopbarVisible: (visible) =>
    set((state) => {
      const value = visible !== false;
      const next = { ...state, monitoringTopbarVisible: value };
      persistNextState(next);
      return next;
    }),
}));
