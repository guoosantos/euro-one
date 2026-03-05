export function withTimeout(promise, timeoutMs, { label = "operation" } = {}) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timeout after ${timeoutMs}ms (${label})`);
      error.code = "OP_TIMEOUT";
      error.timeoutMs = timeoutMs;
      error.label = label;
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export default withTimeout;
