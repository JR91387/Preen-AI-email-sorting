// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSettings, parseSettingsFile, SETTINGS_FILE_FORMAT } from '../../packages/shared/core/settings-io.js';
import { setupSteps } from '../../packages/shared/core/setup.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const current = mergeWithDefaults({
  apiKey: 'sk-mine',
  scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } },
  depth: { default: 'deep', accounts: { a1: 'surface' } },
});

test('export leaves the API key out unless asked', () => {
  const file = exportSettings(current, { now: new Date('2026-09-30T00:00:00Z') });
  assert.equal(file.format, SETTINGS_FILE_FORMAT);
  assert.equal(file.exportedAt, '2026-09-30T00:00:00.000Z');
  assert.equal('apiKey' in file.settings, false);
  assert.equal(file.includesApiKey, false);
  const withKey = exportSettings(current, { includeApiKey: true });
  assert.equal(withKey.settings.apiKey, 'sk-mine');
  assert.equal(withKey.includesApiKey, true);
  assert.equal(current.apiKey, 'sk-mine', 'the settings themselves are unchanged');
});

test('import round-trips and keeps the current key when the file has none', () => {
  const text = JSON.stringify(exportSettings({ ...current, personalContext: 'I run a bakery' }));
  const result = parseSettingsFile(text, current, ['a1']);
  assert.deepEqual(result.errors, []);
  assert.equal(result.settings.personalContext, 'I run a bakery');
  assert.equal(result.settings.apiKey, 'sk-mine');
  assert.match(result.notes[0], /current key was kept/);
  assert.deepEqual(result.settings.scope.accounts.a1, current.scope.accounts.a1);
});

test('import skips settings for accounts that are not on this computer', () => {
  const text = JSON.stringify(exportSettings(current));
  const result = parseSettingsFile(text, current, ['b7']);
  assert.deepEqual(result.settings.scope.accounts, {});
  assert.deepEqual(result.settings.depth.accounts, {});
  assert.ok(result.notes.some((n) => /aren't on this computer/.test(n)));
});

test('import rejects broken, foreign, newer and invalid files', () => {
  assert.match(parseSettingsFile('{nope', current, []).errors[0], /valid JSON/);
  assert.match(parseSettingsFile('{"hello":1}', current, []).errors[0], /Preen settings file/);
  const newer = JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 99, settings: {} });
  assert.match(parseSettingsFile(newer, current, []).errors[0], /newer version/);
  const invalid = JSON.stringify(exportSettings({ ...current, pricePerMillionInputTokens: -1 }));
  const result = parseSettingsFile(invalid, current, ['a1']);
  assert.equal(result.settings, null);
  assert.ok(result.errors.some((e) => /Price per million tokens/.test(e)));
});

test('setup checklist reflects progress', () => {
  const fresh = mergeWithDefaults({});
  assert.deepEqual(setupSteps(fresh, { connectionOk: false, hasHistory: false }).map((s) => s.done), [false, false, false, false], 'four steps: consent first; ticking a mailbox is what switches it on');
  const done = mergeWithDefaults({
    apiKey: 'k', dryRun: false, automation: { enabled: true }, consent: { sendToProvider: '2026-01-01T00:00:00.000Z', provider: 'openrouter' },
    scope: { accounts: { a1: { enabled: true, folders: 'inbox', folderPaths: [] } } },
  });
  assert.ok(setupSteps(done, { connectionOk: true, hasHistory: true }).every((s) => s.done));
  assert.equal(setupSteps({ ...done, apiKey: 'k' }, { connectionOk: false, hasHistory: true })[1].done, false);
});

// --- Removed settings (Phase 4) ----------------------------------------------

const REMOVED = {
  descriptionLimit: 256,
  maxBodyChars: 5000,
  thresholds: { unsureMargin: 0.3 },
  limits: { dailyTokens: 1_000_000, monthlyTokens: 20_000_000, manualMax: 80 },
  automation: { maxPerRun: 7 },
  history: { maxEntries: 500 },
};
const removedKeys = (s) => [
  'descriptionLimit' in s, 'maxBodyChars' in s, 'unsureMargin' in s.thresholds,
  'dailyTokens' in s.limits, 'monthlyTokens' in s.limits, 'manualMax' in s.limits,
  'maxPerRun' in s.automation, 'maxEntries' in s.history,
];

test('removed settings in stored settings load cleanly, the keys dropped and the rest kept', async () => {
  const { createMessenger } = await import('../mocks/messenger.js');
  const { loadSettings } = await import('../../apps/thunderbird/storage/settings.js');
  const { validateSettings } = await import('../../packages/shared/core/settings-schema.js');
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  await env.messenger.storage.local.set({ settings: {
    apiKey: 'k', personalContext: 'baker', ...REMOVED,
    thresholds: { ...REMOVED.thresholds, junk: 0.8 },
    limits: { ...REMOVED.limits, dailyMessages: 123 },
    history: { ...REMOVED.history, retentionDays: 30 },
  } });
  const s = await loadSettings();
  assert.deepEqual(removedKeys(s), Array(8).fill(false));
  assert.deepEqual(validateSettings(s).errors, []);
  assert.equal(s.personalContext, 'baker');
  assert.equal(s.thresholds.junk, 0.8);
  assert.equal(s.limits.dailyMessages, 123);
  assert.equal(s.history.retentionDays, 30);
});

test('importing a file that still has removed settings works and drops them', () => {
  const file = exportSettings(current);
  const old = {
    ...file,
    settings: {
      ...file.settings, ...REMOVED,
      thresholds: { ...file.settings.thresholds, ...REMOVED.thresholds },
      limits: { ...file.settings.limits, ...REMOVED.limits },
      automation: { ...file.settings.automation, ...REMOVED.automation },
      history: { ...file.settings.history, ...REMOVED.history },
    },
  };
  const result = parseSettingsFile(JSON.stringify(old), current, ['a1']);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(removedKeys(result.settings), Array(8).fill(false));
});

test('import names each field that is over the 128-character limit', () => {
  const s = mergeWithDefaults({});
  s.personalContext = 'z'.repeat(129);
  s.categories[0].description = 'x'.repeat(200);
  s.categories[1].excludes = 'y'.repeat(300);
  const r = parseSettingsFile(JSON.stringify(exportSettings(s)), mergeWithDefaults({}), []);
  assert.equal(r.settings, null);
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.join('\n'), /Personal context is longer than 128/);
  assert.match(r.errors.join('\n'), new RegExp(`Category "${s.categories[0].name}": "is" is longer than 128`));
  assert.match(r.errors.join('\n'), new RegExp(`Category "${s.categories[1].name}": "is not" is longer than 128`));
});

test('appearance round-trips through export and import, and a bad value is refused', () => {
  const r = parseSettingsFile(JSON.stringify(exportSettings({ ...current, appearance: 'dark' })), current, ['a1']);
  assert.deepEqual(r.errors, []);
  assert.equal(r.settings.appearance, 'dark');
  const old = exportSettings(current);
  delete old.settings.appearance;
  assert.equal(parseSettingsFile(JSON.stringify(old), current, ['a1']).settings.appearance, 'auto');
  const bad = parseSettingsFile(JSON.stringify(exportSettings({ ...current, appearance: 'purple' })), current, ['a1']);
  assert.equal(bad.settings, null);
  assert.match(bad.errors.join('\n'), /Appearance/);
});

test('import with a non-object accounts group returns errors instead of throwing', () => {
  for (const bad of [null, 'x']) {
    const text = JSON.stringify({ format: SETTINGS_FILE_FORMAT, version: 1, settings: { scope: { accounts: bad } } });
    const result = parseSettingsFile(text, current, ['a1']);
    assert.equal(result.settings, null);
    assert.ok(result.errors.length > 0);
  }
});
