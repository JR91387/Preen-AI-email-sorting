// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// scripts/package.sh in a copied repo with a stub zip; checks the key scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/package.sh', import.meta.url));
const buildScript = fileURLToPath(new URL('../../scripts/build.sh', import.meta.url));

function build(source) {
  const root = mkdtempSync(join(tmpdir(), 'preen-pkg-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps/thunderbird'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  copyFileSync(script, join(root, 'scripts/package.sh'));
  copyFileSync(buildScript, join(root, 'scripts/build.sh'));
  writeFileSync(join(root, 'apps/thunderbird/manifest.json'), '{"version":"9.9.9"}');
  writeFileSync(join(root, 'apps/thunderbird/main.js'), source);
  writeFileSync(join(root, 'bin/zip'), '#!/bin/sh\nfor a; do case "$a" in *.xpi) : > "$a" ;; esac; done\n');
  chmodSync(join(root, 'bin/zip'), 0o755);
  const r = spawnSync('sh', [join(root, 'scripts/package.sh')], {
    env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, PREEN_DIST: join(root, 'dist') },
    encoding: 'utf8',
  });
  return { ...r, xpi: join(root, 'dist/preen-thunderbird-9.9.9.xpi') };
}

test('package.sh builds when the build has no keys', () => {
  const r = build("headers: { 'Authorization': `Bearer ${apiKey}` }\n");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(r.xpi));
});

test('package.sh refuses to build when the build holds something key-shaped', () => {
  for (const leak of ['sk-or-v1-' + 'a1'.repeat(16), '-----BEGIN OPENSSH PRIVATE KEY-----', 'Bearer ' + 'x'.repeat(30)]) {
    const r = build(`const k = '${leak}';\n`);
    assert.notEqual(r.status, 0, leak);
    assert.match(r.stderr, /look like they contain a key/, leak);
    assert.ok(!existsSync(r.xpi), leak);
  }
});
