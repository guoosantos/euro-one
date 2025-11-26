export function ensureHookResult(result = {}, { defaultData = [], extraKeys = {} } = {}) {
  const { data, loading, error, ...rest } = result || {};
  const safeData = Array.isArray(data) ? data : Array.isArray(defaultData) ? defaultData : [];
  return {
    data: safeData,
    loading: Boolean(loading),
    error: error ?? null,
    ...rest,
    ...extraKeys,
  };
}

export default ensureHookResult;
