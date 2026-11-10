// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Retries for temporary provider problems, with increasing delays.

export const RETRYABLE_ERRORS = new Set(['rate_limit', 'server', 'network', 'timeout']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRIES = 2;
const BASE_MS = 2000;
const MAX_MS = 30000;

/** Delay before retry number `attempt` (0-based): 2s, 4s, 8s … capped at 30 s. */
export function backoffMs(attempt) {
  return Math.min(MAX_MS, BASE_MS * 2 ** attempt);
}

/**
 * Calls `fn`, retrying temporary errors up to RETRIES more times.
 * Other errors (e.g. a bad API key) are thrown immediately.
 */
export async function withRetries(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= RETRIES || !RETRYABLE_ERRORS.has(e?.kind)) throw e;
      await sleep(backoffMs(attempt));
    }
  }
}
