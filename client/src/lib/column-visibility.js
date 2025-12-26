const loggedMissingFields = new Set();

export function loadColumnVisibility(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

export function saveColumnVisibility(storageKey, visibility) {
  if (!storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(visibility));
  } catch (_error) {
    // ignore persistence failures
  }
}

export function computeAutoVisibility(items, columns, threshold = 0.9) {
  const total = Array.isArray(items) ? items.length : 0;
  const visibility = {};
  if (!total) {
    columns.forEach((column) => {
      visibility[column.key] = column.defaultVisible ?? true;
    });
    return visibility;
  }

  columns.forEach((column) => {
    const missingCount = items.filter((item) => column.isMissing(item)).length;
    const ratio = total ? missingCount / total : 0;
    const shouldHide = ratio >= threshold;
    visibility[column.key] = shouldHide ? false : column.defaultVisible ?? true;

    if (shouldHide) {
      const logKey = `${column.key}:${threshold}`;
      if (!loggedMissingFields.has(logKey)) {
        loggedMissingFields.add(logKey);
        console.info("[columns] campo ocultado por falta de dados", {
          key: column.key,
          label: column.label,
          missingCount,
          total,
        });
      }
    }
  });

  return visibility;
}
