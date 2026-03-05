function normalizeText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeIsoDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function normalizeRuntimeVersion(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  return {
    builtAt: normalizeIsoDate(payload.builtAt),
    hotfix: normalizeText(payload.hotfix),
    gitSha: normalizeText(payload.gitSha),
    baseBuildAt: normalizeIsoDate(payload.baseBuildAt),
    baseCanonicalArchive: normalizeText(payload.baseCanonicalArchive),
    baseCanonicalSha256: normalizeText(payload.baseCanonicalSha256),
  };
}

async function fetchVersionFrom(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`Falha ao carregar ${url}: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const payload = await response.json();
  return normalizeRuntimeVersion(payload);
}

export async function fetchRuntimeVersion() {
  try {
    return await fetchVersionFrom("/version.json");
  } catch (_primaryError) {
    return fetchVersionFrom(`/version.json?nocache=${Date.now()}`);
  }
}

export { normalizeRuntimeVersion };

export default {
  fetchRuntimeVersion,
  normalizeRuntimeVersion,
};

