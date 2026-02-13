import { create } from "zustand";

const DEFAULT_MESSAGE = "Carregando...";
const AUTO_HIDE_MS = 1500;
let autoHideTimer = null;

function scheduleAutoHide(set) {
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
  }
  autoHideTimer = setTimeout(() => {
    set(() => ({
      count: 0,
      message: DEFAULT_MESSAGE,
    }));
  }, AUTO_HIDE_MS);
}

export const useEagleLoaderStore = create((set) => ({
  count: 1,
  message: DEFAULT_MESSAGE,
  show: (message) =>
    set((state) => {
      scheduleAutoHide(set);
      return {
        count: state.count + 1,
        message: message || state.message || DEFAULT_MESSAGE,
      };
    }),
  hide: () =>
    set((state) => {
      const nextCount = Math.max(0, state.count - 1);
      return {
        count: nextCount,
        message: nextCount === 0 ? DEFAULT_MESSAGE : state.message,
      };
    }),
  register: (message) => {
    set((state) => {
      scheduleAutoHide(set);
      return {
        count: state.count + 1,
        message: message || state.message || DEFAULT_MESSAGE,
      };
    });
    return () => {
      set((state) => {
        const nextCount = Math.max(0, state.count - 1);
        return {
          count: nextCount,
          message: nextCount === 0 ? DEFAULT_MESSAGE : state.message,
        };
      });
    };
  },
  setMessage: (message) =>
    set(() => ({
      message: message || DEFAULT_MESSAGE,
    })),
  reset: () =>
    set(() => ({
      count: 0,
      message: DEFAULT_MESSAGE,
    })),
}));

export const EAGLE_LOADER_DEFAULT_MESSAGE = DEFAULT_MESSAGE;
