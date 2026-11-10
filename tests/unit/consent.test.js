// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { installIndexedDB } from '../mocks/indexeddb.js';
import { clearLog, clearCorrections, readAll } from '../../apps/thunderbird/storage/activity-log.js';
import { classifyMessages } from '../../apps/thunderbird/background/pipeline.js';
import { mergeWithDefaults, validateSettings, DEFAULT_SETTINGS } from '../../packages/shared/core/settings-schema.js';
import { hasConsent, giveConsent, withdrawConsent, waitingForConsent, consentText } from '../../packages/shared/core/consent.js';
import { AWAITING_CONSENT, skipSummary } from '../../packages/shared/core/run-summary.js';
import { setupSteps } from '../../packages/shared/core/setup.js';
import { parseSettingsFile, exportSettings } from '../../packages/shared/core/settings-io.js';

installIndexedDB();

const message = {
  header: {
    headerMessageId: 'msg-1@example',
    author: 'Sam <sam@example.org>',
    subject: 'Invoice 42',
    date: new Date('2026-09-30T10:00:00Z'),
    recipients: ['me@example.com'],
    ccList: [],
    folder: { accountId: 'acct1' },
  },
  full: { contentType: 'text/plain', headers: { from: ['Sam <sam@example.org>'] }, parts: [] },
  textParts: [{ contentType: 'text/plain', content: 'Please pay invoice 42 by Friday.' }],
};
const reply = {
  model: 'jev',
  answers: {
    category: { type: 'choice', choice: 'Receipts', probabilities: { Receipts: 0.9 }, confidence: 0.8 },
    person: { type: 'noul', noul: 0.05 },
    needs_reply: { type: 'noul', noul: 0.1 },
  },
  usage: { input_tokens: 300 },
};

let env;
let requests;
async function setup(stored) {
  env = createMessenger({ messages: { 1: structuredClone(message) } });
  globalThis.messenger = env.messenger;
  await clearLog();
  await clearCorrections();
  await env.messenger.storage.local.set({ settings: mergeWithDefaults({ apiKey: 'k', ...stored }) });
  requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify(reply), { status: 200 });
  };
}
const stored = async () => (await env.messenger.storage.local.get('settings')).settings;
const store = (settings) => env.messenger.storage.local.set({ settings });

beforeEach(() => {
  delete globalThis.messenger;
});

test('consent defaults to none, and settings from before it are asked again', () => {
  assert.equal(DEFAULT_SETTINGS.consent.sendToProvider, null);
  const old = mergeWithDefaults({ apiKey: 'k', provider: 'typesafe' });
  assert.equal(old.consent.sendToProvider, null);
  assert.equal(hasConsent(old), false);
  assert.ok(validateSettings(old).ok);
});

test('consent is a timestamp for one provider; switching provider asks again', () => {
  const s = mergeWithDefaults({ apiKey: 'k' });
  const given = giveConsent(s, new Date('2026-10-19T08:00:00Z'));
  assert.deepEqual(given.consent, { sendToProvider: '2026-10-19T08:00:00.000Z', provider: 'openrouter' });
  assert.equal(hasConsent(given), true);
  assert.ok(validateSettings(given).ok);
  assert.equal(hasConsent({ ...given, provider: 'typesafe' }), false);
  assert.equal(hasConsent(withdrawConsent(given)), false);
  assert.equal(withdrawConsent(given).consent.sendToProvider, null);
});

test('invalid consent values are reported', () => {
  const s = mergeWithDefaults({ apiKey: 'k', consent: { sendToProvider: 'yesterday', provider: 'openrouter' } });
  assert.equal(validateSettings(s).ok, false);
});

test('the consent text names the provider, says what each depth sends, lists every item with a reason and links the privacy policy', () => {
  for (const [id, label] of [['openrouter', 'OpenRouter'], ['typesafe', 'TypeSafe']]) {
    const t = consentText(id);
    assert.match(t.summary, new RegExp(label));
    assert.match(t.summary, /Surface/);
    assert.match(t.summary, /Deep/);
    assert.match(t.summary, /message text/);
    assert.ok(!t.summary.includes('\n') && t.summary.split('. ').length <= 4, 'a short summary');
    // Everything buildState() sends is named, and nothing claims mail goes unsent after local checks.
    const listed = t.fields.map((f) => f.name).join(' | ').toLowerCase();
    for (const piece of ['sender', 'subject', 'date', 'recipients', 'attachment names', 'DMARC', 'contact', 'mailbox', 'personal context', 'languages', 'categories', 'message text']) {
      assert.ok(listed.includes(piece.toLowerCase()), piece);
    }
    for (const f of t.fields) assert.ok(f.why.length > 10 && f.why.length < 100, `a short reason for: ${f.name}`);
    assert.doesNotMatch(JSON.stringify(t), /settled|not sent/);
    assert.equal(t.privacyPage, 'ui/privacy/privacy.html');
  }
  assert.equal(waitingForConsent('TypeSafe'), 'Waiting for your OK to send mail to TypeSafe');
});

test('setup checklist: agreeing to send is the first step', () => {
  const s = mergeWithDefaults({ apiKey: 'k' });
  const [first] = setupSteps(s, { connectionOk: true, hasHistory: false });
  assert.equal(first.id, 'consent');
  assert.equal(first.done, false);
  assert.equal(setupSteps(giveConsent(s), { connectionOk: true, hasHistory: false })[0].done, true);
});

test('run summary counts messages waiting for consent, with the reason', () => {
  const reason = waitingForConsent('OpenRouter');
  const summary = skipSummary([{ skipped: AWAITING_CONSENT, consentReason: reason }, {}]);
  assert.equal(summary.kind, 'consent');
  assert.equal(summary.count, 1);
  assert.equal(summary.reason, reason);
});

test('import keeps the consent in use here, never the file\'s', () => {
  const current = giveConsent(mergeWithDefaults({ apiKey: 'k' }), new Date('2026-10-19T08:00:00Z'));
  const file = JSON.stringify(exportSettings(mergeWithDefaults({ consent: { sendToProvider: '2020-01-01T00:00:00.000Z', provider: 'typesafe' } })));
  assert.deepEqual(parseSettingsFile(file, current, []).settings.consent, current.consent);
  const none = mergeWithDefaults({ apiKey: 'k' });
  const given = JSON.stringify(exportSettings(current));
  assert.equal(parseSettingsFile(given, none, []).settings.consent.sendToProvider, null);
});

test('nothing reaches fetch before consent; the message is skipped with the reason, local checks still run', async () => {
  await setup({ localChecks: { sensitive: true, replacePii: true } });
  const [entry] = await classifyMessages([1]);
  assert.equal(requests.length, 0);
  assert.equal(entry.skipped, AWAITING_CONSENT);
  assert.equal(entry.consentReason, 'Waiting for your OK to send mail to OpenRouter');
  assert.equal(entry.subject, 'Invoice 42', 'the message was read locally');
  const [logged] = await readAll();
  assert.equal(logged.skipped, AWAITING_CONSENT);
});

test('sending resumes after consent, and withdrawing blocks it again', async () => {
  await setup({});
  await classifyMessages([1]);
  assert.equal(requests.length, 0);
  await store(giveConsent(await stored()));
  const [sent] = await classifyMessages([1]);
  assert.equal(requests.length, 1);
  assert.equal(sent.skipped, undefined);
  await store(withdrawConsent(await stored()));
  const [blocked] = await classifyMessages([1]);
  assert.equal(requests.length, 1);
  assert.equal(blocked.skipped, AWAITING_CONSENT);
});

test('withdrawing mid-run stops sending at once', async () => {
  await setup({});
  await store(giveConsent(await stored()));
  globalThis.fetch = async (url, init) => {
    requests.push(JSON.parse(init.body));
    await store(withdrawConsent(await stored()));
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  const results = await classifyMessages([1, 1, 1]);
  assert.equal(requests.length, 1);
  assert.equal(results.filter((r) => r.skipped === AWAITING_CONSENT).length, 2);
});

test('switching provider asks again before sending', async () => {
  await setup({});
  await store(giveConsent(await stored()));
  await store({ ...(await stored()), provider: 'typesafe' });
  const [entry] = await classifyMessages([1]);
  assert.equal(requests.length, 0);
  assert.equal(entry.consentReason, 'Waiting for your OK to send mail to TypeSafe');
});
