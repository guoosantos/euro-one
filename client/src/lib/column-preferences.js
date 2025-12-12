export function buildColumnDefaults(columns = []) {
  const list = Array.isArray(columns) ? columns : [];
  return {
    visible: Object.fromEntries(list.map((column) => [column.key, column.defaultVisible !== false])),
    order: list.map((column) => column.key),
    widths: Object.fromEntries(
      list
        .filter((column) => column.width)
        .map((column) => [column.key, column.width]),
    ),
  };
}

export function mergeColumnPreferences(defaults, saved) {
  const base = defaults || { visible: {}, order: [], widths: {} };
  const visible = { ...base.visible, ...(saved?.visible || {}) };
  const savedOrder = Array.isArray(saved?.order) ? saved.order : [];
  const ordered = savedOrder.filter((key) => base.order.includes(key));
  const missing = base.order.filter((key) => !ordered.includes(key));
  const widths = { ...base.widths, ...(saved?.widths || {}) };
  return {
    visible,
    order: [...ordered, ...missing],
    widths,
  };
}

export function loadColumnPreferences(storageKey, defaults) {
  const fallback = defaults || { visible: {}, order: [], widths: {} };
  if (typeof window === "undefined") return fallback;
  try {
    const saved = window.localStorage?.getItem(storageKey);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    return mergeColumnPreferences(defaults, parsed);
  } catch (_error) {
    return fallback;
  }
}

export function saveColumnPreferences(storageKey, prefs) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(storageKey, JSON.stringify(prefs));
  } catch (_error) {
    // ignore
  }
}

export function reorderColumns(currentPrefs, fromKey, toKey, defaults) {
  if (!fromKey || !toKey || fromKey === toKey) return currentPrefs;
  const base = defaults || { order: [] };
  const currentOrder = currentPrefs?.order?.length ? [...currentPrefs.order] : [...base.order];
  const fromIndex = currentOrder.indexOf(fromKey);
  const toIndex = currentOrder.indexOf(toKey);
  if (fromIndex === -1 || toIndex === -1) return currentPrefs;
  const nextOrder = [...currentOrder];
  const [moved] = nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, moved);
  return { ...currentPrefs, order: nextOrder };
}

export function resolveVisibleColumns(columns, prefs) {
  const list = Array.isArray(columns) ? columns : [];
  const visible = prefs?.visible || {};
  const order = prefs?.order || [];
  const ordered = order
    .map((key) => list.find((column) => column.key === key))
    .filter(Boolean)
    .filter((column) => visible[column.key] !== false);
  const missing = list.filter((column) => !order.includes(column.key) && visible[column.key] !== false);
  const combined = [...ordered, ...missing];
  const movable = combined.filter((column) => column.fixed !== true);
  const fixed = combined.filter((column) => column.fixed === true);
  return [...movable, ...fixed];
}
