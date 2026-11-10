// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Provider table. Both providers speak the same System One API, so a
// provider is just a base URL, a default model and optional extra headers.

import { classify } from './systemone.js';
import { readNoul } from '../core/rules.js';

export const PROVIDERS = {
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api',
    origin: 'https://openrouter.ai/api/v1/systemone',
    defaultModel: 'jev-1.13',
    extraHeaders: { 'X-Title': 'Preen' },
  },
  typesafe: {
    label: 'TypeSafe',
    baseUrl: 'https://api.typesafe.ai',
    origin: 'https://api.typesafe.ai/v1/systemone',
    defaultModel: 'jev-1.13.0',
    extraHeaders: {},
  },
};

export function resolveProvider(settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) throw new Error(`Unknown provider: ${settings.provider}`);
  return { ...provider, id: settings.provider, model: settings.model || provider.defaultModel };
}

/** Sends a prepared { state, questions } request; fills in the model. */
export function classifyWith(settings, request, fetchImpl, onExchange = null) {
  const provider = resolveProvider(settings);
  return classify({
    baseUrl: provider.baseUrl,
    apiKey: settings.apiKey,
    body: { model: provider.model, ...request },
    extraHeaders: provider.extraHeaders,
    fetchImpl,
    onExchange,
  });
}

/**
 * Asks one tiny yes/no question to check the key, model and connection, and
 * that Preen can read the answer.
 * @returns {Promise<{model: string, usage: object, answersUnderstood: boolean}>}
 */
export async function testConnection(settings, fetchImpl) {
  const response = await classifyWith(settings, {
    state: 'Preen is checking that it can reach the Jev model.',
    questions: {
      connection_test: { type: 'noul', instructions: 'Is this message a connection check?' },
    },
  }, fetchImpl);
  return {
    model: response.model,
    usage: response.usage,
    answersUnderstood: readNoul(response.answers?.connection_test) !== null,
  };
}
