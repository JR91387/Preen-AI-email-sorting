// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The privacy page reads the packaged PRIVACY.md and builds elements from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setUpPage } from './page-env.js';

const policy = readFileSync(new URL('../../PRIVACY.md', import.meta.url), 'utf8');
const { document, errors } = setUpPage('privacy/privacy');
const asked = [];
globalThis.fetch = async (url) => { asked.push(String(url)); return { ok: true, text: async () => `${policy}\n\nSee [the site](https://example.test/x).` }; };
await import('../../apps/thunderbird/ui/privacy/privacy.js');

test('the page fetches the packaged policy and shows one h2 per ## heading, with no raw Markdown', () => {
  assert.equal(asked.length, 1);
  assert.match(asked[0], /\/apps\/thunderbird\/PRIVACY\.md$/, 'resolved next to the add-on root, without the extension API');
  const shown = [...document.querySelectorAll('#policy h2')].map((h) => h.textContent);
  assert.deepEqual(shown, policy.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).replaceAll('**', '').trim()));
  assert.doesNotMatch(document.getElementById('policy').textContent, /\*\*|\]\(/);
  assert.deepEqual(errors, []);
});

test('links in the policy open in a new tab without opener access', () => {
  const links = [...document.querySelectorAll('#policy a')];
  assert.equal(links.length, 1);
  for (const a of links) {
    assert.equal(a.target, '_blank');
    assert.equal(a.rel, 'noopener');
  }
});
