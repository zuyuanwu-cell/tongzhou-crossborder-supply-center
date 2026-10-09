export function isTransientIntegrationError(error) {
  const message = String(error?.message || error || "");
  return /(?:HTTP|request failed)\s*(?:408|425|429|500|502|503|504)\b|\b(?:408|425|429|500|502|503|504)\s+(?:bad gateway|gateway timeout|service unavailable)|timeout|timed out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(message);
}

export async function withTransientRetry(operation, {
  attempts = 3,
  delayMs = 1000,
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isTransientIntegrationError(error)) throw error;
      await sleep(Math.max(0, delayMs) * attempt);
    }
  }
  throw lastError;
}
