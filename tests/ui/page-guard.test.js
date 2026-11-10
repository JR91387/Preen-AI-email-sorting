// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The page guard: a visible message when a page fails to load or doesn't
// match the installed version (F13), and the versions kept in sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPage } from '../mocks/dom.js';

const src = (p) => fileURLToPath(new URL(`../../apps/thunderbird/${p}`, import.meta.url));
const version = JSON.parse(readFileSync(src('manifest.json'), 'utf8')).version;
const guard = readFileSync(src('ui/shared/page-guard.js'), 'utf8');
const PAGES = ['options/options', 'activity/activity', 'popup/popup'];

function runGuard(installedVersion) {
  const { document } = loadPage(src('ui/options/options.html'));
  globalThis.messenger = { runtime: { getManifest: () => ({ version: installedVersion }) } };
  new Function(guard)(); // runs the guard as a plain script, as the page does
  return document;
}

const bannerOf = (document) => document.body.querySelector('.page-error');

test('every page declares the same version as the add-on and loads the guard first', () => {
  for (const page of PAGES) {
    const html = readFileSync(src(`ui/${page}.html`), 'utf8');
    assert.match(html, new RegExp(`<meta name="preen-version" content="${version.replace(/\./g, '\\.')}">`), page);
    assert.ok(html.indexOf('page-guard.js') < html.indexOf('type="module"'), `${page}: guard before the page script`);
  }
});

test('no banner when the page loads normally', () => {
  assert.equal(bannerOf(runGuard(version)), null);
});

test('a load error shows a banner with the detail and a Reload button', () => {
  const document = runGuard(version);
  window.dispatch('error', { message: 'TypeError: something broke' });
  const banner = bannerOf(document);
  assert.ok(banner);
  assert.match(banner.textContent, /didn't load properly.*something broke/);
  assert.ok(banner.querySelector('button'));
});

test('a different installed version shows a banner straight away', () => {
  const banner = bannerOf(runGuard('9.9.9'));
  assert.ok(banner);
  assert.match(banner.textContent, new RegExp(`Preen ${version.replace(/\./g, '\\.')}.*Preen 9\\.9\\.9 is installed`));
});

test('an async start-up failure shows the load banner', () => {
  const document = runGuard(version);
  window.dispatch('unhandledrejection', { reason: new Error('storage unavailable') });
  assert.match(bannerOf(document).textContent, /didn't load properly.*storage unavailable/);
});

test('an error after loading is described as a failed action, and the detail is capped', () => {
  const document = runGuard(version);
  window.dispatch('load', {});
  window.dispatch('error', { message: 'x'.repeat(1000) });
  const text = bannerOf(document).textContent;
  assert.match(text, /^Something went wrong/);
  assert.ok(!text.includes('x'.repeat(301)));
});
