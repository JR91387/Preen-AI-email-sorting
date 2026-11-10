// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, mergeWithDefaults, validateSettings, DESCRIPTION_LIMIT, MAX_BODY_CHARS, UNSURE_MARGIN, SUGGESTED_CATEGORIES } from '../../packages/shared/core/settings-schema.js';

test('defaults are valid', () => {
  assert.deepEqual(validateSettings(mergeWithDefaults({})), { ok: true, errors: [] });
});

test('merge keeps defaults for missing keys and merges nested objects', () => {
  const s = mergeWithDefaults({ apiKey: 'k', thresholds: { category: 0.9 } });
  assert.equal(s.apiKey, 'k');
  assert.equal(s.thresholds.category, 0.9);
  assert.equal(s.thresholds.realPerson, DEFAULT_SETTINGS.thresholds.realPerson);
});

test('merge returns a copy, never the frozen defaults', () => {
  const s = mergeWithDefaults(undefined);
  s.categories.push({ name: 'X', description: 'y' });
  assert.equal(DEFAULT_SETTINGS.categories.length, 4);
});

test('rejects bad categories', () => {
  const bad = (categories) => validateSettings(mergeWithDefaults({ categories })).ok;
  assert.equal(bad([]), false);
  assert.equal(bad([{ name: 'Other', description: 'x' }]), false);
  assert.equal(bad([{ name: 'A/B', description: 'x' }]), false);
  assert.equal(bad([{ name: 'A', description: '' }]), false);
  assert.equal(bad([{ name: 'A', description: 'x' }, { name: 'a', description: 'y' }]), false);
  assert.equal(bad(Array.from({ length: 21 }, (_, i) => ({ name: `C${i}`, description: 'x' }))), false, 'more than 20');
  assert.equal(bad(Array.from({ length: 20 }, (_, i) => ({ name: `C${i}`, description: 'x' }))), true, '20 is allowed');
});

test('rejects bad thresholds and provider', () => {
  const check = (patch) => validateSettings(mergeWithDefaults(patch)).ok;
  assert.equal(check({ thresholds: { category: 1.5 } }), false);
  assert.equal(check({ thresholds: { realPerson: 1.2 } }), false);
  assert.equal(check({ provider: 'nope' }), false);
});

test('validates depth settings', () => {
  const check = (depth) => validateSettings(mergeWithDefaults({ depth })).ok;
  assert.equal(check({ default: 'surface', accounts: { account1: 'deep' } }), true);
  assert.equal(check({ default: 'medium' }), false);
  assert.equal(check({ default: 'deep', accounts: { account1: 'bogus' } }), false);
  assert.equal(check({ default: 'deep', accounts: [] }), false);
});

test('validates Stage 3 settings', () => {
  const ok = (patch) => validateSettings(mergeWithDefaults(patch)).ok;
  assert.equal(ok({ dryRun: false }), true);
  assert.equal(ok({ dryRun: 'no' }), false);
  assert.equal(ok({ actions: { moveJunk: 'yes' } }), false);
  assert.equal(ok({ categories: [{ name: 'A', description: 'x', actions: { flag: true } }] }), true);
  assert.equal(mergeWithDefaults({ categories: [{ name: 'A', description: 'x', actions: { delete: true } }] }).categories[0].actions, undefined);
  assert.equal(ok({ categories: [{ name: 'A', description: 'x', actions: { flag: 'yes' } }] }), false);
});

test('rejects categories whose tags would collide', () => {
  const ok = (categories) => validateSettings(mergeWithDefaults({ categories })).ok;
  assert.equal(ok([{ name: 'To do', description: 'x' }, { name: 'To-do', description: 'y' }]), false);
  assert.equal(ok([{ name: 'Needs-Reply', description: 'x' }]), false);
  assert.equal(ok([{ name: '!!!', description: 'x' }]), false);
});

test('dry run is off by default', () => {
  assert.equal(DEFAULT_SETTINGS.dryRun, false);
});

test('"is not" is optional text; both fields are limited to 128 characters', () => {
  const ok = (c) => validateSettings(mergeWithDefaults({ categories: [{ name: 'A', description: 'x', ...c }] })).ok;
  assert.equal(ok({}), true);
  assert.equal(ok({ excludes: 'not ads' }), true);
  assert.equal(ok({ excludes: 42 }), false);
  assert.equal(ok({ excludes: 'x'.repeat(129) }), false);
  assert.equal(ok({ description: 'x'.repeat(129) }), false);
});

test('every default category has both "is" and "is not"', () => {
  for (const c of DEFAULT_SETTINGS.categories) {
    assert.ok(c.description.trim() && c.excludes.trim(), c.name);
  }
});

test('the description limit is fixed at 128: 128 is allowed, 129 is not', () => {
  assert.equal(DESCRIPTION_LIMIT, 128);
  assert.equal(DEFAULT_SETTINGS.descriptionLimit, undefined, 'no longer a setting');
  const ok = (c) => validateSettings(mergeWithDefaults({ categories: [{ name: 'A', description: 'x', ...c }] })).ok;
  assert.equal(ok({ description: 'x'.repeat(128), excludes: 'y'.repeat(128) }), true);
  assert.equal(ok({ excludes: 'y'.repeat(129) }), false);
});

test('the other fixed sizes hold today\'s defaults and are not settings', () => {
  assert.equal(MAX_BODY_CHARS, 2000);
  assert.equal(UNSURE_MARGIN, 0.15);
  assert.equal(DEFAULT_SETTINGS.maxBodyChars, undefined);
  assert.equal(DEFAULT_SETTINGS.thresholds.unsureMargin, undefined);
});

test('price per million tokens is optional and must be a non-negative number', () => {
  const ok = (pricePerMillionInputTokens) => validateSettings(mergeWithDefaults({ pricePerMillionInputTokens })).ok;
  assert.equal(DEFAULT_SETTINGS.pricePerMillionInputTokens, null);
  assert.equal(ok(null), true);
  assert.equal(ok(0), true);
  assert.equal(ok(0.25), true);
  assert.equal(ok(-1), false);
  assert.equal(ok('0.25'), false);
  // NaN can't survive a JSON round trip, so check it without merging.
  assert.equal(validateSettings({ ...mergeWithDefaults({}), pricePerMillionInputTokens: NaN }).ok, false);
});

test('the default categories are exactly Personal, Work, Bills, Codes, in that order; no suggestions are offered', () => {
  assert.deepEqual(DEFAULT_SETTINGS.categories.map((c) => c.name), ['Personal', 'Work', 'Bills', 'Codes']);
  assert.deepEqual(SUGGESTED_CATEGORIES, []);
  assert.equal(validateSettings(mergeWithDefaults({})).ok, true);
});

test('D130: "Never a To-do" is on by default for Codes only, and must be true or false', () => {
  const on = DEFAULT_SETTINGS.categories.filter((c) => c.noToDo === true).map((c) => c.name);
  assert.deepEqual(on, ['Codes']);
  assert.ok(DEFAULT_SETTINGS.categories.every((c) => c.noToDo === undefined || typeof c.noToDo === 'boolean'));
  assert.equal(mergeWithDefaults({}).categories.find((c) => c.name === 'Codes').noToDo, true);
  const check = (noToDo) => validateSettings(mergeWithDefaults({ categories: [{ name: 'A', description: 'x', noToDo }] }));
  assert.equal(check(false).ok, true);
  const bad = check('yes');
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join(' '), /"Never a To-do" must be on or off/);
});

test('keys the schema no longer has are dropped by the merge, not rejected', () => {
  const s = mergeWithDefaults({
    gone: 1,
    thresholds: { personHigh: 0.85 },
    localChecks: { sensitiveNoSend: true },
    categories: [{ name: 'A', description: 'x', actions: { markRead: true, flag: true } }],
  });
  assert.equal('gone' in s, false);
  assert.equal('personHigh' in s.thresholds, false);
  assert.equal('sensitiveNoSend' in s.localChecks, false);
  assert.deepEqual(s.categories[0].actions, { flag: true });
  assert.deepEqual(validateSettings(s).errors, []);
});

test('debug mode is off by default and stays off for settings saved before it existed', () => {
  assert.equal(mergeWithDefaults({}).debug.enabled, false);
  assert.equal(mergeWithDefaults({ dryRun: false }).debug.enabled, false);
  assert.equal(mergeWithDefaults({ debug: { enabled: true, junk: 1 } }).debug.enabled, true);
  assert.deepEqual(Object.keys(mergeWithDefaults({ debug: { enabled: true, junk: 1 } }).debug), ['enabled']);
  assert.equal(validateSettings(mergeWithDefaults({ debug: { enabled: 'yes' } })).ok, false);
});

test('appearance defaults to auto, is filled in for old installs, and must be auto, light or dark', () => {
  assert.equal(DEFAULT_SETTINGS.appearance, 'auto');
  assert.equal(mergeWithDefaults({ apiKey: 'k' }).appearance, 'auto');
  const check = (appearance) => validateSettings(mergeWithDefaults({ appearance })).ok;
  for (const ok of ['auto', 'light', 'dark']) assert.equal(check(ok), true, ok);
  for (const bad of ['', 'Dark', 'blue', null, 1]) assert.equal(check(bad), false, String(bad));
});
