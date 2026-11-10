// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROVIDERS } from '../../packages/shared/providers/index.js';

const manifest = JSON.parse(readFileSync(new URL('../../apps/thunderbird/manifest.json', import.meta.url), 'utf8'));

test('host permissions cover exactly each provider\'s fetch path', () => {
  for (const p of Object.values(PROVIDERS)) assert.equal(p.origin, `${p.baseUrl}/v1/systemone`);
  assert.deepEqual([...manifest.host_permissions].sort(), Object.values(PROVIDERS).map((p) => p.origin).sort());
});

test('declares sensitiveDataUpload, which ATN requires for sending mail to a provider', () => {
  assert.ok(manifest.permissions.includes('sensitiveDataUpload'));
});

test('extension pages run only their own scripts, and none is inline', () => {
  assert.deepEqual(manifest.content_security_policy, { extension_pages: "script-src 'self'; object-src 'self'" });
  for (const page of ['activity/activity', 'confirm/confirm', 'options/options', 'popup/popup']) {
    const html = readFileSync(new URL(`../../apps/thunderbird/ui/${page}.html`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)|\son[a-z]+\s*=/, page);
  }
});
