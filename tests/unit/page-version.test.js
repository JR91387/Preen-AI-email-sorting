// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Every Preen page carries the add-on's version in a meta tag, and page-guard compares it with the
// installed version. A page left on an older number shows the "reload the page" error box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../apps/thunderbird/', import.meta.url);

test('every page meta preen-version matches the manifest version', async () => {
  const { version } = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  const pages = [];
  for (const dir of await readdir(new URL('ui/', root), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(new URL(`ui/${dir.name}/`, root))) if (file.endsWith('.html')) pages.push(`ui/${dir.name}/${file}`);
  }
  assert.ok(pages.length >= 4, `found ${pages.length} pages`);
  for (const page of pages) {
    const html = await readFile(new URL(page, root), 'utf8');
    const meta = html.match(/<meta name="preen-version" content="([^"]+)">/);
    if (meta) assert.equal(meta[1], version, page);
  }
});
