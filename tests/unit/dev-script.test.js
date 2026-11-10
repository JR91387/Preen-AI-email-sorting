// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// scripts/dev.sh against a fake HOME with stub flatpak and zip; nothing is launched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../scripts/dev.sh', import.meta.url));

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'preen-dev-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'flatpak'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'flatpak'), 0o755);
  writeFileSync(join(bin, 'zip'), '#!/bin/sh\nfor a; do case "$a" in *.xpi) : > "$a" ;; esac; done\n');
  chmodSync(join(bin, 'zip'), 0o755);
  const run = (...args) => spawnSync('bash', [script, '--skip-tests', '--no-launch', ...args], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, PREEN_PROFILE: '', PREEN_DIST: join(home, 'dist') },
    encoding: 'utf8',
  });
  return { home, run };
}

test('dev.sh refuses profile names that are not preen-…', () => {
  const { run } = sandbox();
  for (const name of ['default', '../preen-x', 'preen-', 'preen-a b']) {
    const r = run('--profile', name);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stdout + r.stderr, /profile name/i, name);
  }
});

test('dev.sh adds its prefs to user.js between markers, once, keeping the rest', () => {
  const { home, run } = sandbox();
  const dir = join(home, '.var/app/org.mozilla.thunderbird/.thunderbird/preen-test');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'user.js'), 'user_pref("mine", 1);\n');
  assert.equal(run('--profile', 'preen-test').status, 0);
  assert.equal(run('--profile', 'preen-test').status, 0);
  const text = readFileSync(join(dir, 'user.js'), 'utf8');
  assert.ok(text.startsWith('user_pref("mine", 1);\n'));
  assert.equal(text.match(/extensions\.autoDisableScopes/g).length, 1);
});

test('dev.sh builds into PREEN_DIST and leaves the repo dist/ untouched', () => {
  const repoDist = fileURLToPath(new URL('../../dist', import.meta.url));
  const snap = () => (existsSync(repoDist) ? readdirSync(repoDist).map((f) => [f, statSync(join(repoDist, f)).mtimeMs]) : []);
  const before = snap();
  const { home, run } = sandbox();
  mkdirSync(join(home, '.var/app/org.mozilla.thunderbird/.thunderbird/preen-test'), { recursive: true });
  assert.equal(run('--profile', 'preen-test').status, 0);
  assert.deepEqual(readdirSync(join(home, 'dist')).filter((f) => f.endsWith('.xpi')).length, 1);
  assert.ok(existsSync(join(home, 'dist/thunderbird/manifest.json')));
  assert.deepEqual(snap(), before);
});
