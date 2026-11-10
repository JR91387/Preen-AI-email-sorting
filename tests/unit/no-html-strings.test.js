// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Pages are built from nodes, never from markup strings: the add-on store flags every
// assignment to innerHTML, and a string of markup is how injected text becomes code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Links (apps/thunderbird/core, providers) point into packages/, which is scanned itself.
function* scripts(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory() && e.name !== 'node_modules') yield* scripts(path);
    else if (e.isFile() && e.name.endsWith('.js')) yield path;
  }
}

test('no script under apps/ or packages/ uses innerHTML, outerHTML or insertAdjacentHTML', () => {
  const files = [...scripts(join(root, 'apps')), ...scripts(join(root, 'packages'))];
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const hits = files.flatMap((f) => readFileSync(f, 'utf8').split('\n')
    .flatMap((line, i) => (/innerHTML|outerHTML|insertAdjacentHTML/.test(line) ? [`${f}:${i + 1}`] : [])));
  assert.deepEqual(hits, []);
});
