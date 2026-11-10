// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Add-ons review (ATN) confirmations: the API key's handling, PII replacement on previews,
// the content of the connection test, and the declared host permissions.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { clearLog, readAll, readDebug } from '../../apps/thunderbird/storage/activity-log.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';
import { exportSettings } from '../../packages/shared/core/settings-io.js';
import { debugSubmission } from '../../packages/shared/core/debug.js';
import { testConnection } from '../../packages/shared/providers/index.js';
import { PII_BLOCK } from '../../packages/shared/core/sensitive.js';

installIndexedDB();

const KEY = 'sk-or-v1-ATN-SECRET-7788';
const CARD = '4111 1111 1111 1111';
const AGREED = { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' };
const manifest = JSON.parse(readFileSync(new URL('../../apps/thunderbird/manifest.json', import.meta.url), 'utf8'));

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const isDir = e.isDirectory() || (e.isSymbolicLink() && statSync(new URL(e.name, dir)).isDirectory());
    const path = new URL(e.name + (isDir ? '/' : ''), dir);
    if (isDir) return sources(path);
    return e.name.endsWith('.js') ? [{ file: path.pathname, text: readFileSync(path, 'utf8') }] : [];
  });
}
const SRC = sources(new URL('../../apps/thunderbird/', import.meta.url));

const reply = {
  model: 'jev',
  answers: {
    category: { type: 'choice', choice: 'Receipts', probabilities: { Receipts: 0.9 }, confidence: 0.8 },
    person: { type: 'noul', noul: 0.05 },
    needs_reply: { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 300 },
};
const message = {
  header: {
    headerMessageId: 'atn-1@example', author: 'Sam <sam@example.org>', subject: `Card ${CARD} on file`,
    date: new Date('2026-09-30T10:00:00Z'), recipients: ['me@example.com'], ccList: [], folder: { accountId: 'acct1' },
  },
  full: { contentType: 'text/plain', headers: { from: ['Sam <sam@example.org>'] }, parts: [] },
  textParts: [{ contentType: 'text/plain', content: `Please charge ${CARD} for invoice 42.` }],
};

let env;
let requests;
async function setup(extra = {}) {
  env = createMessenger({ messages: { 1: structuredClone(message) } });
  globalThis.messenger = env.messenger;
  await clearLog();
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: KEY, consent: AGREED, ...extra }) });
  requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: init.body });
    return new Response(JSON.stringify(reply), { status: 200 });
  };
}
beforeEach(() => { delete globalThis.messenger; });

test('(a) nothing in src uses storage.sync or storage.managed', () => {
  for (const { file, text } of SRC) assert.doesNotMatch(text, /storage\??\.(sync|managed)\b/, file);
});

test('(a) no console call in src names the key, the settings object or the auth header', () => {
  for (const { file, text } of SRC) {
    for (const call of text.match(/console\.\w+\([^;]*\)/g) ?? []) {
      assert.doesNotMatch(call, /apiKey|\bsettings\b|Authorization|Bearer/i, `${file}: ${call}`);
    }
  }
});

test('(a) a run (including a failing one that echoes the key) never writes the key outside the settings record, and never logs it', async () => {
  await setup({ debug: { enabled: true }, depth: { default: 'deep', accounts: {} } });
  const logged = [];
  const saved = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) { saved[m] = console[m]; console[m] = (...a) => logged.push(a); }
  try {
    await classifyMessages([1], { apply: true });
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 });
    await classifyMessages([1], { apply: false });
  } finally {
    Object.assign(console, saved);
  }
  const entries = await readAll();
  const debug = (await Promise.all(entries.filter((e) => e.debugId).map((e) => readDebug(e.debugId)))).flat();
  assert.ok(debug.length > 0, 'debug records exist');
  assert.equal(JSON.stringify(entries).includes(KEY), false, 'activity log');
  assert.equal(JSON.stringify(debug).includes(KEY), false, 'debug log');
  assert.equal(requests.some((r) => r.body.includes(KEY)), false, 'request bodies');
  assert.equal(JSON.stringify(logged, (k, v) => (v instanceof Error ? v.message + v.stack : v)).includes(KEY), false, 'console output');
  const { settings, ...rest } = env.store;
  assert.equal(JSON.stringify(rest).includes(KEY), false, 'other storage keys');
  assert.equal(settings.apiKey, KEY, 'the key lives only in the local settings record');
});

test('(a) a settings export has the key only when "Include my API key" is ticked; the debug submission always scrubs it', () => {
  const settings = mergeWithDefaults({ apiKey: KEY });
  assert.equal(JSON.stringify(exportSettings(settings)).includes(KEY), false);
  assert.equal(JSON.stringify(exportSettings(settings, { includeApiKey: false })).includes(KEY), false);
  const withKey = exportSettings(settings, { includeApiKey: true });
  assert.equal(withKey.settings.apiKey, KEY);
  assert.equal(withKey.includesApiKey, true);
  const sub = debugSubmission([{ at: 'x', records: [{ request: `a ${KEY}`, response: KEY, error: KEY }], fixes: [] }], { apiKey: KEY });
  assert.equal(JSON.stringify(sub).includes(KEY), false);
});

for (const apply of [true, false]) {
  test(`(b) PII is replaced in the subject and message text of ${apply ? 'applied' : 'preview'} requests`, async () => {
    await setup({ depth: { default: 'deep', accounts: {} } });
    await classifyMessages([1], { apply });
    assert.ok(requests.length >= 1);
    for (const r of requests) {
      assert.equal(r.body.includes('4111'), false, 'card number absent');
      assert.ok(r.body.includes(PII_BLOCK), 'replaced by the block marker');
    }
    assert.ok(requests.some((r) => r.body.includes('invoice 42')), 'message text was sent (so the replacement was exercised)');
  });
}

test('(c) the Test connection request has a fixed text and one question, and no message fields', async () => {
  await setup();
  const bodies = [];
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify(reply), { status: 200 }); };
  await testConnection(mergeWithDefaults({ apiKey: KEY }), fetchImpl);
  assert.equal(bodies.length, 1);
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['model', 'questions', 'state']);
  assert.equal(bodies[0].state, 'Preen is checking that it can reach the Jev model.');
  assert.deepEqual(Object.keys(bodies[0].questions), ['connection_test']);
  assert.doesNotMatch(JSON.stringify(bodies[0]), /sender|subject|author|recipient|body|attachment|dmarc|contact/i);
  const src = readFileSync(new URL('../../packages/shared/providers/index.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function testConnection'));
  assert.doesNotMatch(fn, /getEmail|messages\.|getFull|headerMessageId/);
});

test('(d) host permissions are exactly the two provider endpoints; no telemetry or submit host is declared', () => {
  assert.deepEqual(manifest.host_permissions, ['https://openrouter.ai/api/v1/systemone', 'https://api.typesafe.ai/v1/systemone']);
  assert.equal([...(manifest.optional_host_permissions ?? []), ...(manifest.optional_permissions ?? [])].some((p) => /:\/\//.test(p)), false);
  assert.equal(manifest.permissions.some((p) => /:\/\//.test(p) || p === '<all_urls>'), false);
});
