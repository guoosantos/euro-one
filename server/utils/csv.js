function sanitizeValue(value) {
  if (value === undefined || value === null) return "";
  const normalized = String(value).replace(/\r?\n/g, " ").trim();
  const shouldQuote = /[",\n]/.test(normalized);
  const escaped = normalized.replace(/"/g, '""');
  return shouldQuote ? `"${escaped}"` : escaped;
}

export function stringifyCsv(rows = [], columns = []) {
  const cols = Array.isArray(columns) && columns.length ? columns : Object.keys(rows[0] || {}).map((key) => ({ key }));
  const header = cols.map((col) => sanitizeValue(col.label || col.key)).join(",");
  const lines = rows.map((row) =>
    cols
      .map((col) => {
        const value = typeof col.accessor === "function" ? col.accessor(row) : row?.[col.key];
        return sanitizeValue(value);
      })
      .join(","),
  );

  return [header, ...lines].join("\n");
}

export default { stringifyCsv };
