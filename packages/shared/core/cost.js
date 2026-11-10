// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Tokens are what Preen measures and limits. Prices vary by provider and over
// time, so no price is built in: cost is only shown when the provider reports
// it (OpenRouter's usage.cost) or the user has entered their own price.

/**
 * @param {object} usage the response's usage object
 * @param {number|null} [pricePerMillion] user's price per million input tokens
 * @returns {{usd: number, source: 'provider'|'user price'}|null} null when unknown
 */
export function costFromUsage(usage, pricePerMillion = null) {
  if (typeof usage?.cost === 'number' && Number.isFinite(usage.cost)) {
    return { usd: Math.max(0, usage.cost), source: 'provider' };
  }
  const tokens = Number(usage?.input_tokens);
  if (typeof pricePerMillion === 'number' && Number.isFinite(pricePerMillion) && Number.isFinite(tokens)) {
    return { usd: Math.max(0, costOfTokens(tokens, pricePerMillion)), source: 'user price' };
  }
  return null;
}

/**
 * Price per million input tokens implied by a reported cost (Jev's output
 * tokens are free, so the whole cost is input). Rounded to 4 significant
 * figures, since a test request is small. Null when the provider didn't
 * report a cost.
 */
export function priceFromUsage(usage) {
  const cost = usage?.cost;
  const tokens = Number(usage?.input_tokens);
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || !(tokens > 0)) return null;
  return Number(((cost / tokens) * 1e6).toPrecision(4));
}

/** Cost of `tokens` input tokens at the user's price, or null without one. */
export function costOfTokens(tokens, pricePerMillion) {
  return typeof pricePerMillion === 'number' ? (tokens * pricePerMillion) / 1e6 : null;
}

/**
 * Average input tokens per message from the monthly summaries, or null without history.
 * Messages kept from the AI count as messages with no tokens, so this errs a little low.
 */
export function averageTokens(summaries) {
  let messages = 0;
  let tokens = 0;
  for (const s of summaries ?? []) {
    messages += Number(s?.messages) || 0;
    tokens += Number(s?.tokens) || 0;
  }
  return messages > 0 && tokens > 0 ? tokens / messages : null;
}

const validPrice = (price) => typeof price === 'number' && Number.isFinite(price) && price >= 0;

/** Estimated cost of `count` messages of `avgTokens` each at the user's price; null without both. */
export function costOfEmails(avgTokens, pricePerMillion, count) {
  if (!(avgTokens > 0) || !validPrice(pricePerMillion)) return null;
  return costOfTokens(avgTokens * count, pricePerMillion);
}

/** Tokens and (with a price) cost expected for a run of `count` messages; null without an average. */
export function estimateRun(count, avgTokens, pricePerMillion = null) {
  if (!(avgTokens > 0) || !(count > 0)) return null;
  return { tokens: Math.round(avgTokens * count), usd: costOfEmails(avgTokens, pricePerMillion, count) };
}

/** Rounds up to 1, 2 or 5 times a power of ten, so a suggested limit reads as a plain number. */
export function roundUpNice(value) {
  if (!(value > 0)) return null;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((m) => m * power >= value * (1 - 1e-9));
  return Number((step * power).toPrecision(6));
}

/** A starting monthly limit: what `emails` messages cost, rounded up; null without an average and a price. */
export function suggestMonthlyLimit(avgTokens, pricePerMillion, emails = 1000) {
  return roundUpNice(costOfEmails(avgTokens, pricePerMillion, emails));
}

/** Rough token count for English text (about 4 characters per token). */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/** Formats token counts, e.g. 950, 12.3k, 4.2M. */
export function formatTokens(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '?';
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return `${Number((n / 1000).toPrecision(3))}k`;
  return `${Number((n / 1e6).toPrecision(3))}M`;
}

/** Formats small amounts readably, e.g. $0.000055 or $1.23; '–' when unknown. */
export function formatUsd(usd) {
  if (usd === null || usd === undefined) return '–';
  if (!usd) return '$0';
  if (usd >= 0.01) return `$${usd.toFixed(2)}`;
  return `$${Number(usd.toPrecision(2))}`;
}
