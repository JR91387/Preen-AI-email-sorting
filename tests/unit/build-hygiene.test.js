// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The build output holds no hidden files or folders (tool caches, editor and OS leftovers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildScript = fileURLToPath(new URL('../../scripts/build.sh', import.meta.url));

const hidden = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const path = join(dir, e.name);
  return [...(e.name.startsWith('.') ? [path] : []), ...(e.isDirectory() && !e.name.startsWith('.') ? hidden(path) : [])];
});

test('building removes hidden files and folders at any depth and keeps the rest', () => {
  const root = mkdtempSync(join(tmpdir(), 'preen-hidden-'));
  const app = join(root, 'apps/thunderbird');
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(app, 'ui/.ruff_cache/0.1'), { recursive: true });
  mkdirSync(join(app, '.hidden-dir'));
  copyFileSync(buildScript, join(root, 'scripts/build.sh'));
  writeFileSync(join(app, 'manifest.json'), '{"version":"9.9.9"}');
  writeFileSync(join(app, 'ui/page.html'), '<p>x</p>');
  writeFileSync(join(app, 'ui/.DS_Store'), '');
  writeFileSync(join(app, 'ui/.ruff_cache/0.1/cache'), '');
  writeFileSync(join(app, '.hidden-dir/file'), '');
  writeFileSync(join(app, '.gitkeep'), '');
  const dist = join(root, 'dist');
  const r = spawnSync('sh', [join(root, 'scripts/build.sh')], { env: { ...process.env, PREEN_DIST: dist }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = join(dist, 'thunderbird');
  assert.deepEqual(hidden(out), []);
  assert.ok(existsSync(join(out, 'manifest.json')) && existsSync(join(out, 'ui/page.html')));
});

test('the real build has no hidden entries', () => {
  const dist = mkdtempSync(join(tmpdir(), 'preen-real-'));
  const r = spawnSync('sh', [buildScript], { env: { ...process.env, PREEN_DIST: dist }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(hidden(join(dist, 'thunderbird')), []);
});
