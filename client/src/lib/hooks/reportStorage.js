export const isBrowserStorageAvailable = () => typeof window !== "undefined" && Boolean(window?.localStorage);

export const readCachedReport = (key, normalize) => {
  if (!isBrowserStorageAvailable()) return null;

  try {
    const cached = window.localStorage.getItem(key);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    return typeof normalize === "function" ? normalize(parsed) : parsed;
  } catch (_error) {
    return null;
  }
};

export const writeCachedReport = (key, value) => {
  if (!isBrowserStorageAvailable()) return;

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_error) {
    // Ignore persistence failures on environments without storage access
  }
};
