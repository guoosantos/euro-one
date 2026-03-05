export function normalizePrefix(prefix) {
  if (prefix === null || prefix === undefined) return null;
  const trimmed = String(prefix).trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

export function buildInternalCode(prefix, sequence) {
  const resolvedPrefix = normalizePrefix(prefix);
  const resolvedSequence = Number(sequence);
  if (!resolvedPrefix || !Number.isFinite(resolvedSequence) || resolvedSequence <= 0) return null;
  return String(resolvedPrefix * 100000 + Math.trunc(resolvedSequence));
}

export function extractInternalSequence(code, prefix) {
  const resolvedPrefix = normalizePrefix(prefix);
  if (!resolvedPrefix || code === null || code === undefined) return null;
  const numeric = Number(String(code).trim());
  if (!Number.isFinite(numeric)) return null;
  const base = resolvedPrefix * 100000;
  if (numeric <= base) return null;
  const sequence = numeric - base;
  if (!Number.isInteger(sequence) || sequence <= 0) return null;
  return sequence;
}

