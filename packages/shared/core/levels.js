// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Low / Medium / High presets for settings that are really a level. Each group
// has a caption naming a quantity, and High always means MORE of it. Settings
// store plain numbers; the level is worked out from them, and anything that
// doesn't match a preset is "custom".

export const LEVELS = ['low', 'medium', 'high'];
export const LEVEL_LABELS = { low: 'Low', medium: 'Medium', high: 'High', custom: 'Custom' };

/**
 * Each group: caption, the settings fields it covers (dotted paths), the
 * preset values for those fields, and a one-line summary per level.
 */
export const LEVEL_GROUPS = {
  allowance: {
    caption: 'Daily allowance',
    // A level sets the daily message limit; only Custom shows the box.
    fields: ['limits.dailyMessages'],
    presets: {
      low: [100],
      medium: [500],
      high: [2000],
    },
    summary: {
      low: 'Up to about 100 emails a day.',
      medium: 'Up to about 500 emails a day.',
      high: 'Up to about 2,000 emails a day.',
    },
  },
  certainty: {
    caption: 'Certainty required',
    fields: ['threshold'], // a category's own threshold (categories[i].threshold)
    presets: { low: [0.6], medium: [0.75], high: [0.9] },
    summary: {
      low: 'Tags more readily; a few more mistakes.',
      medium: 'Balanced.',
      high: 'Only when very sure; more get no category.',
    },
  },
  realPerson: {
    caption: 'Certainty required',
    fields: ['thresholds.realPerson'],
    // Genuine personal mail scores ~0.6–0.93, so the levels sit in that range.
    presets: { low: [0.6], medium: [0.7], high: [0.8] },
    summary: {
      low: 'Tags more emails as from a real person.',
      medium: 'Balanced.',
      high: 'Only when clearly typed by a person.',
    },
  },
  needsReply: {
    caption: 'Certainty required',
    fields: ['thresholds.needsReply'],
    // At 0.6 the sample correspondence got more wrong tags than right ones, so the default is 0.7.
    presets: { low: [0.6], medium: [0.7], high: [0.8] },
    summary: {
      low: 'Flags more emails as needing a reply.',
      medium: 'Balanced.',
      high: 'Only when someone is clearly waiting for you.',
    },
  },
  toDo: {
    caption: 'Certainty required',
    fields: ['thresholds.toDo'],
    presets: { low: [0.45], medium: [0.65], high: [0.75] },
    summary: {
      low: 'Spots more emails as to-dos.',
      medium: 'Balanced.',
      high: 'Only when there is clearly something for you to do.',
    },
  },
  junk: {
    caption: 'Certainty required',
    fields: ['thresholds.junk'],
    presets: { low: [0.65], medium: [0.8], high: [0.9] },
    summary: {
      low: 'Marks more emails as junk.',
      medium: 'Balanced.',
      high: 'Only when it is clearly junk.',
    },
  },
  history: {
    caption: 'History kept',
    fields: ['history.retentionDays'],
    presets: { low: [30], medium: [90], high: [365] },
    summary: {
      low: '30 days.',
      medium: '90 days.',
      high: 'A year.',
    },
  },
};

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

/** The level matching the values in `source`, or 'custom'. */
export function levelOf(group, source) {
  const g = LEVEL_GROUPS[group];
  const values = g.fields.map((f) => getPath(source, f));
  if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return 'custom';
  for (const level of LEVELS) {
    if (g.presets[level].every((v, i) => values[i] === v)) return level;
  }
  return 'custom';
}

const num = (n) => Number(n).toLocaleString();

/**
 * A Custom value as a share of the High level, e.g. 3,000 messages a day → 150.
 * Null when there's nothing to compare: no limit (0) on either side.
 */
export function percentOfHigh(group, field, value) {
  const g = LEVEL_GROUPS[group];
  const i = g.fields.indexOf(field);
  if (i < 0) throw new Error(`No field ${field} in level group ${group}`);
  const high = g.presets.high[i];
  if (!(value > 0) || !(high > 0)) return null;
  return (value / high) * 100;
}
const limit = (n, unit) => (n > 0 ? [[num(n)], ` ${unit}`] : [`no limit on ${unit}`]);
const capitalise = ([first, ...rest]) => [typeof first === 'string' ? first[0].toUpperCase() + first.slice(1) : first, ...rest];
const decimal = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 });
const probability = (values, path) => [[decimal(getPath(values, path))], ' on a 0–1 scale'];

// The value line shown next to the buttons. Parts in [brackets] are shown in bold.
const VALUE_TEXT = {
  allowance: (v) => {
    const { dailyMessages } = v.limits;
    return dailyMessages > 0 ? ['Up to about ', ...limit(dailyMessages, 'emails a day')] : capitalise(limit(0, 'emails a day'));
  },
  certainty: (v) => [[decimal(v.threshold)], ' on a 0–1 scale'],
  realPerson: (v) => probability(v, 'thresholds.realPerson'),
  needsReply: (v) => probability(v, 'thresholds.needsReply'),
  toDo: (v) => probability(v, 'thresholds.toDo'),
  junk: (v) => probability(v, 'thresholds.junk'),
  history: (v) => [[num(v.history.retentionDays)], ' days'],
};

/**
 * The current values in words, e.g. "Up to about 500 emails a day · …".
 * @returns {(string|[string])[]} text parts; a part wrapped in an array is a
 *   number to show in bold. Empty when a value is missing.
 */
export function valueText(group, values) {
  const g = LEVEL_GROUPS[group];
  if (g.fields.some((f) => !Number.isFinite(getPath(values, f)))) return [];
  return VALUE_TEXT[group](values);
}

/** Writes a level's preset values into `target` (a settings object or a category). */
export function applyLevel(group, level, target) {
  const g = LEVEL_GROUPS[group];
  g.fields.forEach((f, i) => setPath(target, f, g.presets[level][i]));
  return target;
}
