// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify, ProviderError } from '../../packages/shared/providers/systemone.js';
import { classifyWith, testConnection, resolveProvider } from '../../packages/shared/providers/index.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/responses/choice-and-nouls.json', import.meta.url)));
const KEY = 'sk-test-secret-123';

function jsonResponse(status, data) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function recordingFetch(response) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return typeof response === 'function' ? response(url, init) : response;
  };
  return { calls, fetchImpl };
}

test('OpenRouter: correct URL, auth header, title header and model', async () => {
  const { calls, fetchImpl } = recordingFetch(jsonResponse(200, fixture));
  const settings = mergeWithDefaults({ provider: 'openrouter', apiKey: KEY });
  const res = await classifyWith(settings, { state: 's', questions: {} }, fetchImpl);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(calls[0].init.headers['X-Title'], 'Preen');
  assert.equal(calls[0].body.model, 'jev-1.13');
  assert.equal(res.answers.category.choice, 'Receipts');
  assert.equal(res.usage.input_tokens, 1287);
});

test('TypeSafe: correct URL and a user-chosen model overrides the default', async () => {
  const { calls, fetchImpl } = recordingFetch(jsonResponse(200, fixture));
  const settings = mergeWithDefaults({ provider: 'typesafe', apiKey: KEY, model: 'jev-preview' });
  await classifyWith(settings, { state: 's', questions: {} }, fetchImpl);
  assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(calls[0].body.model, 'jev-preview');
  assert.equal(calls[0].init.headers['X-Title'], undefined);
});

async function expectKind(fetchImpl, kind, opts = {}) {
  await assert.rejects(
    classify({ baseUrl: 'https://x.example', apiKey: KEY, body: {}, fetchImpl, ...opts }),
    (e) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.kind, kind);
      assert.ok(!e.message.includes(KEY), 'API key must never appear in errors');
      return true;
    },
  );
}

test('maps HTTP errors to kinds', async () => {
  await expectKind(async () => jsonResponse(401, { error: { message: 'bad key' } }), 'auth');
  await expectKind(async () => jsonResponse(403, {}), 'auth');
  await expectKind(async () => jsonResponse(429, {}), 'rate_limit');
  await expectKind(async () => jsonResponse(503, {}), 'server');
  await expectKind(async () => jsonResponse(400, { message: 'unknown model' }), 'bad_request');
});

test('redacts the key if a server echoes it', async () => {
  await expectKind(async () => jsonResponse(401, { error: { message: `invalid key ${KEY}` } }), 'auth');
});

test('network failure and timeout', async () => {
  await expectKind(async () => { throw new TypeError('fetch failed'); }, 'network');
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await expectKind(hang, 'timeout', { timeoutMs: 20 });
});

test('rejects responses without answers or with invalid JSON', async () => {
  await expectKind(async () => jsonResponse(200, { model: 'x' }), 'bad_response');
  await expectKind(async () => new Response('not json', { status: 200 }), 'bad_response');
});

test('testConnection asks one noul question and returns the model', async () => {
  const { calls, fetchImpl } = recordingFetch(jsonResponse(200, {
    model: 'jev-1.13.0',
    answers: { connection_test: { type: 'noul', noul: 0.97 } },
    usage: { input_tokens: 40 },
  }));
  const result = await testConnection(mergeWithDefaults({ apiKey: KEY }), fetchImpl);
  assert.equal(result.model, 'jev-1.13.0');
  assert.equal(calls[0].body.questions.connection_test.type, 'noul');
});

test('resolveProvider rejects unknown providers', () => {
  assert.throws(() => resolveProvider({ provider: 'nope' }));
});

test('onExchange: the exact request and response strings, status, ms, model and UTC time, never headers', async () => {
  const responseText = '{ "model": "jev-1.13",\n  "answers": {"category": {"type": "choice", "choice": "Bills"}}, "usage": {} }';
  const exchanges = [];
  let sent;
  const fetchImpl = async (url, init) => {
    sent = init.body;
    return new Response(responseText, { status: 200 });
  };
  const body = { model: 'jev-1.13', state: 'Café ☕ "quoted"', questions: {} };
  await classify({ baseUrl: 'https://x.example', apiKey: KEY, body, fetchImpl, onExchange: (x) => exchanges.push(x) });
  assert.equal(exchanges.length, 1);
  const [x] = exchanges;
  assert.equal(x.request, sent, 'request is byte-equal to the body sent');
  assert.equal(Buffer.compare(Buffer.from(x.response), Buffer.from(responseText)), 0, 'response is byte-equal');
  assert.equal(x.status, 200);
  assert.equal(x.model, 'jev-1.13');
  assert.equal(typeof x.ms, 'number');
  assert.match(x.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(x.error, null);
  assert.ok(!JSON.stringify(x).includes(KEY), 'the API key is never in an exchange');
  assert.equal('headers' in x, false);
});

test('onExchange: failed requests are recorded with their kind; a throwing callback is ignored', async () => {
  const exchanges = [];
  const onExchange = (x) => exchanges.push(x);
  await expectKind(async () => new Response(`{"error":{"message":"bad ${KEY}"}}`, { status: 401 }), 'auth', { onExchange });
  await expectKind(async () => { throw new TypeError('fetch failed'); }, 'network', { onExchange });
  assert.deepEqual(exchanges.map((x) => [x.status, x.error]), [[401, 'auth'], [null, 'network']]);
  assert.ok(!exchanges[0].response.includes(KEY), 'an echoed key is redacted');
  assert.equal(exchanges[1].response, null);
  const res = await classify({
    baseUrl: 'https://x.example', apiKey: KEY, body: {}, fetchImpl: async () => jsonResponse(200, fixture), onExchange: () => { throw new Error('boom'); },
  });
  assert.equal(res.answers.category.choice, 'Receipts');
});
