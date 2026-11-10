// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Lab item 22: the toolbar button's visible label is just "Preen". The status
// goes in the tooltip (action.setTitle) and the badge, never in the label.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../apps/thunderbird/manifest.json', import.meta.url), 'utf8'));

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const isDir = statSync(new URL(e.name, dir)).isDirectory(); // follows the core and providers links
    const path = new URL(e.name + (isDir ? '/' : ''), dir);
    if (isDir) return sources(path);
    return e.name.endsWith('.js') ? [readFileSync(path, 'utf8')] : [];
  });
}

test('the toolbar button label is a fixed "Preen"; nothing changes it at run time', () => {
  assert.equal(manifest.action.default_label, 'Preen');
  const code = sources(new URL('../../apps/thunderbird/', import.meta.url)).join('\n');
  assert.doesNotMatch(code, /action\.setLabel/);
});
