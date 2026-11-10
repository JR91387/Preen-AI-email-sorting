// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Preen's Thunderbird tags. Each tag has a key (stored on the message, synced
// to IMAP servers as a keyword) and a display name like "Preen/Receipts".

export const TAG_NAME_PREFIX = 'Preen/';
export const TAG_KEY_PREFIX = 'preen_';
export const PROCESSED_TAG_KEY = 'preen_processed';

// Full display names of the fixed tags.
export const REAL_PERSON_TAG = TAG_NAME_PREFIX + 'Real person';
export const NEEDS_REPLY_TAG = TAG_NAME_PREFIX + 'Needs reply';
export const JUNK_TAG = TAG_NAME_PREFIX + 'Junk';

// Preen tags only in the affirmative: there's no "not a real person" tag.
// To-do, Review and Sensitive are decisions only (flag, no category, activity note): they get no tag.
const FIXED_TAGS = {
  'Real person': '#2E7D32',
  'Needs reply': '#C62828',
  // Shown beside Thunderbird's own Junk mark, which is a column hidden by default.
  Junk: '#212121',
};

// Keys kept from earlier versions, so existing tags (and undo) keep working
// after a rename. "Real person" was called "Person".
const KEY_OVERRIDES = {
  'real person': 'preen_person',
};

const CATEGORY_COLORS = [
  '#1565C0', '#6A1B9A', '#00838F', '#AD1457', '#558B2F', '#4E342E',
  '#283593', '#00695C', '#9E9D24', '#5D4037', '#37474F', '#D84315',
];

/** Tag key for a short name, e.g. "Needs reply" → "preen_needs_reply". */
export function tagKey(shortName) {
  const override = KEY_OVERRIDES[String(shortName).trim().toLowerCase()];
  if (override) return override;
  const slug = String(shortName)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? TAG_KEY_PREFIX + slug : '';
}

/** Tag key for a full display name, e.g. "Preen/Receipts" → "preen_receipts". */
export function keyForTagName(name) {
  const short = name.startsWith(TAG_NAME_PREFIX) ? name.slice(TAG_NAME_PREFIX.length) : name;
  return tagKey(short);
}

/** Every tag Preen may use with the current settings: {key, name, color}. */
export function tagSpecs(settings) {
  const specs = settings.categories.map((c, i) => ({
    key: tagKey(c.name.trim()),
    name: TAG_NAME_PREFIX + c.name.trim(),
    color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
  }));
  for (const [short, color] of Object.entries(FIXED_TAGS)) {
    specs.push({ key: tagKey(short), name: TAG_NAME_PREFIX + short, color });
  }
  if (settings.markProcessed.tag) {
    specs.push({ key: PROCESSED_TAG_KEY, name: 'Preen: processed', color: '#9E9E9E' });
  }
  return specs;
}
