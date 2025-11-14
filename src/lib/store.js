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
  theme: "dark",
  locale: "pt-BR",
  ...loadState(),
};

export const useUI = create((set, get) => ({
  ...initialState,
  toggle: () =>
    set((state) => {
      const next = { ...state, sidebarOpen: !state.sidebarOpen };
      persistState({ theme: next.theme, locale: next.locale });
      return next;
    }),
  setTheme: (theme) => {
    set((state) => {
      const nextTheme = theme || state.theme;
      const next = { ...state, theme: nextTheme };
      persistState({ theme: nextTheme, locale: next.locale });
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
      persistState({ theme: next.theme, locale: nextLocale });
      if (typeof document !== "undefined") {
        document.documentElement.lang = nextLocale;
      }
      return next;
    });
  },
}));
