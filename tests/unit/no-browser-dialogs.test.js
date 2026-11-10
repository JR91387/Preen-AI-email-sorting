// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Preen asks and informs with its own in-page dialog (askDialog in ui.js), never the browser's
// confirm() or alert().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../apps/thunderbird', import.meta.url));
function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(js|html)$/.test(entry.name)) yield path;
  }
}

test('no confirm( or alert( call anywhere in src', () => {
  const found = [];
  for (const file of sources(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/(^|[^\w.$])(window\.)?(confirm|alert)\s*\(/.test(line)) found.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(found, []);
});
