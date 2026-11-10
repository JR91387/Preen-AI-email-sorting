// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Client for the System One endpoint (POST {baseUrl}/v1/systemone) used to
// ask Jev questions. TypeSafe and OpenRouter accept the same request body.

const MAX_DETAIL_CHARS = 300;

export class ProviderError extends Error {
  /**
   * @param {'auth'|'rate_limit'|'server'|'network'|'timeout'|'bad_request'|'bad_response'} kind
   * @param {string} message
   * @param {number} [status]
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
  }
}

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

// Never let the API key leak into an error message, even if a server echoes it.
function redact(text, apiKey) {
  if (!text) return '';
  return apiKey ? String(text).split(apiKey).join('[redacted]') : String(text);
}

/**
 * Sends one System One request. `onExchange`, if given, receives the request
 * and response exactly as sent and received (never the headers), for the debug log.
 * @returns {Promise<{model: string, answers: object, usage: object, ms: number}>} `ms`: response time
 */
export async function classify({
  baseUrl,
  apiKey,
  body,
  extraHeaders = {},
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
  onExchange = null,
}) {
  const request = JSON.stringify(body);
  const started = Date.now();
  const exchange = { at: new Date(started).toISOString(), status: null, ms: 0, model: body?.model ?? '', request, response: null, error: null };
  // Timed on every call (the response time counts in the statistics), not only in debug.
  const report = () => {
    exchange.ms = Date.now() - started;
    if (!onExchange) return;
    if (exchange.response !== null) exchange.response = redact(exchange.response, apiKey);
    try {
      onExchange(exchange);
    } catch (e) {
      console.warn('Preen: could not record the exchange', e);
    }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await send();
    report();
    return { ...result, ms: exchange.ms };
  } catch (e) {
    exchange.error = e.kind ?? 'internal';
    report();
    throw e;
  } finally {
    clearTimeout(timer);
  }

  async function send() {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: request,
        signal: controller.signal,
      });
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new ProviderError('timeout', `No response within ${timeoutMs / 1000}s`);
      }
      throw new ProviderError('network', 'Could not reach the provider (network error)');
    }
    exchange.status = res.status;

    let text;
    try {
      text = await res.text();
    } catch (e) {
      if (e?.name === 'AbortError') {
        throw new ProviderError('timeout', `No response within ${timeoutMs / 1000}s`);
      }
      throw new ProviderError(res.ok ? 'bad_response' : kindForStatus(res.status), `HTTP ${res.status}`, res.status);
    }
    exchange.response = text;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = undefined; // Error bodies aren't always JSON.
    }

    if (!res.ok) {
      const detail = data?.error?.message ?? data?.message ?? '';
      // Redacted first, then capped: a server's error text is stored and shown, so it stays short.
      const message = `HTTP ${res.status}${detail ? `: ${redact(detail, apiKey).slice(0, MAX_DETAIL_CHARS)}` : ''}`;
      throw new ProviderError(kindForStatus(res.status), message, res.status);
    }
    if (data === undefined) throw new ProviderError('bad_response', 'Provider returned invalid JSON');
    if (!data || typeof data.answers !== 'object' || data.answers === null) {
      throw new ProviderError('bad_response', 'Provider response has no answers');
    }
    if (data.model) exchange.model = data.model;
    return { model: data.model ?? '', answers: data.answers, usage: data.usage ?? {} };
  }
}
