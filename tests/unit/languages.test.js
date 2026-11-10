// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageNames, suggestedLanguages, MAX_LANGUAGES_LENGTH } from '../../packages/shared/core/languages.js';
import { mergeWithDefaults, validateSettings, DEFAULT_SETTINGS } from '../../packages/shared/core/settings-schema.js';

const NAMES = { 'en-US': 'English (US)', en: 'English', es: 'Spanish', 'es-MX': 'Spanish (Mexico)', fr: 'French' };
const nameOf = (tag) => {
  if (!(tag in NAMES)) throw new RangeError('bad tag');
  return NAMES[tag];
};

test('names are readable and de-duplicated; a bare language yields to its regional form', () => {
  assert.deepEqual(languageNames(['en-US', 'en', 'es', 'en-US'], nameOf), ['English (US)', 'Spanish']);
  assert.deepEqual(languageNames(['en', 'en-US'], nameOf), ['English (US)']);
  assert.deepEqual(languageNames(['es', 'es-MX'], nameOf), ['Spanish (Mexico)']);
});

test('invalid or empty tags are skipped', () => {
  assert.deepEqual(languageNames(['', 'xx-bad', null, 'fr'], nameOf), ['French']);
});

test('the real Intl names work without injection', () => {
  const names = languageNames(['en-US', 'de']);
  assert.equal(names.length, 2);
  assert.match(names[0], /English/);
  assert.match(names[1], /German/);
});

test('pre-fill: UI language first, then the browser list', () => {
  const settings = mergeWithDefaults({});
  assert.equal(suggestedLanguages(settings, { uiLanguage: 'en-US', languages: ['en-US', 'en', 'es'] }, nameOf), 'English (US), Spanish');
});

test('pre-fill happens only when the user has never decided', () => {
  const env = { uiLanguage: 'fr', languages: [] };
  assert.equal(suggestedLanguages(mergeWithDefaults({}), env, nameOf), 'French');
  assert.equal(suggestedLanguages(mergeWithDefaults({ recipientLanguagesSet: true }), env, nameOf), '', 'chose to leave it empty');
  assert.equal(suggestedLanguages(mergeWithDefaults({ recipientLanguages: 'German' }), env, nameOf), '', 'already filled');
  assert.equal(suggestedLanguages(mergeWithDefaults({}), {}, nameOf), '', 'nothing known');
});

test('the pre-fill never exceeds the limit and never cuts a name in half', () => {
  const tags = Array.from({ length: 40 }, (_, i) => `t${i}`);
  const long = (tag) => `${tag}-${'x'.repeat(30)}`;
  const text = suggestedLanguages(mergeWithDefaults({}), { languages: tags }, long);
  assert.ok(text.length <= MAX_LANGUAGES_LENGTH);
  assert.ok(text.split(', ').every((n) => n.endsWith('x'.repeat(30))));
});

test('schema: default empty and not set; max 200 characters; text only', () => {
  assert.equal(DEFAULT_SETTINGS.recipientLanguages, '');
  assert.equal(DEFAULT_SETTINGS.recipientLanguagesSet, false);
  const ok = (patch) => validateSettings(mergeWithDefaults(patch)).ok;
  assert.equal(ok({ recipientLanguages: 'x'.repeat(200) }), true);
  assert.equal(ok({ recipientLanguages: `  ${'x'.repeat(200)}  ` }), true, 'trimmed length counts');
  assert.equal(ok({ recipientLanguages: 'x'.repeat(201) }), false);
  assert.equal(ok({ recipientLanguages: 5 }), false);
  assert.equal(ok({ recipientLanguagesSet: 'yes' }), false);
});
