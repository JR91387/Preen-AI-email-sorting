// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The consent panel on the settings page: agree, not now, withdraw, and a new provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setImmediate as tick } from 'node:timers/promises';
import { setUpPage } from './page-env.js';

const { document, env } = setUpPage('options/options');
document.querySelector('header.topbar').offsetHeight = 140;
await import('../../apps/thunderbird/ui/options/options.js');
const $ = (id) => document.getElementById(id);
const fire = (node, type, event = {}) => {
  for (const fn of node.listeners[type] ?? []) fn({ target: node, preventDefault() {}, ...event });
};
const settle = async () => { for (let i = 0; i < 4; i++) await tick(); };
const text = (node) => node.textContent.replace(/\s+/g, ' ').trim();
const stored = async () => (await env.messenger.storage.local.get('settings')).settings;

test('first visit: the panel asks, names the provider, says what is sent and links the privacy policy', () => {
  assert.equal($('consentPanel').hidden, false);
  const t = text($('consentText'));
  for (const piece of ['OpenRouter', 'Surface', 'Deep', 'message text']) assert.ok(t.includes(piece), piece);
  assert.equal($('consentPrivacy').href, 'ui/privacy/privacy.html', 'the policy page ships inside the add-on');
  assert.equal(existsSync(new URL('../../apps/thunderbird/ui/privacy/privacy.html', import.meta.url)), true);
  assert.equal($('consentAgree').hidden, false);
  assert.equal($('consentNotNow').hidden, false);
  assert.equal($('consentWithdraw').hidden, true);
  assert.match(text($('setupSteps')), /agree to send mail/);
});

test('the privacy link opens the packaged policy page in a tab', async () => {
  const opened = [];
  env.messenger.tabs.create = async (tab) => { opened.push(tab.url); };
  let prevented = false;
  fire($('consentPrivacy'), 'click', { preventDefault() { prevented = true; } });
  await settle();
  assert.equal(prevented, true);
  assert.deepEqual(opened, ['ui/privacy/privacy.html']);
});

test('the full list is folded away and gives every item a reason', () => {
  assert.ok($('consentDetails').getAttribute('open') === null, 'closed until asked for');
  const items = [...$('consentFields').children].map(text);
  assert.ok(items.length >= 10);
  for (const piece of ['sender', 'subject', 'date', 'recipients', 'Attachment names', 'DMARC', 'contact', 'mailbox', 'personal context', 'languages', 'categories', 'message text']) {
    assert.ok(items.some((i) => i.includes(piece)), piece);
  }
  assert.ok(items.every((i) => i.includes('. ') && i.split('. ')[1].length > 10), 'each item says why');
});

test('Surface / Deep is chosen in the panel and is the Default depth; it needs Save', async () => {
  assert.equal($('consentDepth').value, $('depthDefault').value);
  $('consentDepth').value = 'surface';
  fire($('consentDepth'), 'change');
  assert.equal($('depthDefault').value, 'surface');
  assert.match(text($('consentDepthHelp')), /never sends the message text/i);
  assert.ok($('depthMark').classList.contains('pending'));
  assert.equal($('dirty').hidden, false, 'Save shows the change');
  $('depthDefault').value = 'deep';
  fire($('depthDefault'), 'change');
  assert.equal($('consentDepth').value, 'deep', 'follows the Accounts setting');
  $('depthMark').hidden = true;
});

test('Not now changes nothing stored and says nothing is sent', async () => {
  fire($('consentNotNow'), 'click');
  await settle();
  assert.equal((await stored())?.consent?.sendToProvider ?? null, null);
  assert.match(text($('consentState')), /Nothing is sent/);
});

test('I agree stores the time and provider, and offers Withdraw', async () => {
  fire($('consentAgree'), 'click');
  await settle();
  const { consent } = await stored();
  assert.equal(consent.provider, 'openrouter');
  assert.ok(!Number.isNaN(Date.parse(consent.sendToProvider)));
  assert.equal($('consentAgree').hidden, true);
  assert.equal($('consentWithdraw').hidden, false);
  assert.match(text($('consentState')), /You agreed/);
});

test('Save keeps the consent', async () => {
  fire($('settings'), 'submit');
  await settle();
  assert.equal((await stored()).consent.provider, 'openrouter');
});

test('choosing another provider asks again for that provider', async () => {
  $('provider').value = 'typesafe';
  fire($('provider'), 'change');
  await settle();
  assert.equal($('consentAgree').hidden, false);
  assert.ok(text($('consentText')).includes('TypeSafe'));
  $('provider').value = 'openrouter';
  fire($('provider'), 'change');
  await settle();
  assert.equal($('consentAgree').hidden, true);
});

test('Withdraw consent clears it at once', async () => {
  fire($('consentWithdraw'), 'click');
  await settle();
  assert.equal((await stored()).consent.sendToProvider, null);
  assert.equal($('consentAgree').hidden, false);
  assert.equal($('consentWithdraw').hidden, true);
});
