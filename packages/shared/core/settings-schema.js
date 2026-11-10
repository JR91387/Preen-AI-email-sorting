// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Default settings, validation and merging of stored settings over defaults.

import { PROVIDERS } from '../providers/index.js';
import { DEPTH_MODES } from './depth.js';
import { tagKey } from './tags.js';
import { FOLDER_SCOPES, ACCOUNT_TYPES } from './scope.js';
import { MAX_LANGUAGES_LENGTH } from './languages.js';
import { SPEEDS } from './pace.js';
import { getPath } from './levels.js';

export const MAX_CATEGORIES = 20;

// Offered in the editor as one-click additions; none for now.
export const SUGGESTED_CATEGORIES = [];
export const MAX_NAME_LENGTH = 40;
// Fixed sizes (not settings): characters in each category "is" / "is not" and in the
// personal context, characters of message text Deep sends, and how close to a
// threshold an answer is noted as "unsure" in the log.
export const DESCRIPTION_LIMIT = 128;
export const MAX_BODY_CHARS = 2000;
export const UNSURE_MARGIN = 0.15;

export const APPEARANCES = ['auto', 'light', 'dark'];

export const DEFAULT_SETTINGS = Object.freeze({
  provider: 'openrouter',
  apiKey: '',
  model: '', // empty = the provider's default model
  // Optional: the user's price per million input tokens, only for showing
  // estimated costs. null = unknown (tokens are shown instead).
  pricePerMillionInputTokens: null,
  personalContext: '',
  // Languages the user reads (free text, sent as a hint so Jev can judge mail
  // in other languages). Empty = nothing sent. The "Set" flag records that the
  // user has decided, so an empty box isn't pre-filled again.
  recipientLanguages: '',
  recipientLanguagesSet: false,
  // While on, Preen only shows what it would do and never changes messages.
  dryRun: false,
  // Page colors: 'auto' follows Thunderbird's light/dark setting.
  appearance: 'auto',
  // Turn off to skip category sorting: no category question is asked and no Preen/<category>
  // tag is applied; the yes/no questions still run. The categories below are kept for turning it back on.
  categorySort: { enabled: true },
  // Each category: name (also the tag), description ("is"), optional excludes
  // ("is not"), optional threshold (certainty required; default
  // thresholds.category), optional actions: { flag, markUnread } and optional
  // noToDo (true = never a To-do for this category's mail). Preen never
  // marks mail as read: "read" means the user read it.
  categories: [
    {
      name: 'Personal',
      description: 'Personal mail from friends or family: plans, news, favours and shared costs',
      excludes: 'Events from organisations, bills from companies, or mail sent to many people',
    },
    {
      name: 'Work',
      description: 'Mail with colleagues, clients or partners about your work: projects, meetings, documents and decisions',
      excludes: 'Newsletters, or automated notifications from work apps and tools',
    },
    {
      name: 'Bills',
      description: 'Bills, account statements and payment-due notices',
      excludes: 'Receipts for purchases already made, or splitting costs with friends',
    },
    {
      name: 'Codes',
      description: 'Temporary one-time, verification or two-factor (2FA) codes and sign-in links',
      excludes: 'Alerts about account activity',
      noToDo: true,
    },
  ],
  depth: {
    default: 'deep',
    accounts: {}, // accountId → 'surface' | 'deep'; missing = default
  },
  questions: {
    person: true,
    needsReply: true,
    toDo: true, // a task other than replying (pay, sign, book, attend…)
    junk: false, // spam, scams, phishing → Thunderbird's own Junk mark (IMAP $Junk)
  },
  // Checks done on this computer only.
  localChecks: {
    sensitive: false, // tag mail with number-shaped personal data: cards, IBANs, SSNs, DOB, passport, licence
    replacePii: true, // the same patterns' matches become <PII_Block> in the subject and text sent
  },
  actions: {
    flagNeedsReply: false, // flag messages tagged Needs reply
    flagToDo: false, // flag messages tagged To-do (syncs to iCloud, Gmail and others as flagged/starred)
    moveJunk: false, // opt-in: move mail Preen marks as junk to the account's Junk folder
  },
  automation: {
    enabled: false, // starts paused: nothing runs automatically until switched on
    trigger: 'scheduled', // 'realtime' | 'scheduled' | 'manual'
    intervalMinutes: 15,
    maxAgeDays: 2, // only mail received in the last N days
    unreadOnly: false,
  },
  scope: {
    // accountId → { enabled, folders: 'inbox' | 'all' | 'selected' | 'except', folderPaths: [],
    //   type?: 'personal' | 'work' | 'founder' | 'shared' | 'other', note?: string }; missing = off
    accounts: {},
  },
  limits: {
    // Apply to all API use, including right-click. 0 (or null for cost) = no limit.
    dailyMessages: 500,
    monthlyCostUsd: null, // estimated: this month's tokens × the user's price; needs a price
  },
  history: {
    retentionDays: 90,
  },
  markProcessed: {
    // Also tag processed messages (syncs through IMAP to other computers).
    // A local record is always kept.
    tag: true,
  },
  thresholds: {
    category: 0.75, // minimum probability of the chosen category
    realPerson: 0.7, // P(written by a real person) at or above → "Real person" tag (tuned on sample mail)
    needsReply: 0.7, // tuned on sample mail
    toDo: 0.65, // tuned on sample mail: fewer wrong tags, none lost
    junk: 0.9, // High by default: marking real mail as junk is the costly mistake
  },
  // When the user agreed to send mail to the provider (ISO time), and which provider. null = not yet.
  consent: { sendToProvider: null, provider: null },
  speed: 'medium', // low | medium | high | off (no limit, discouraged)
  // While on, each request and response is kept in full, on this computer only.
  debug: { enabled: false },
  // Usage reports are off and have no control in this version (see core/telemetry.js).
  telemetry: { enabled: false, shareCategories: false },
});

// Names of Preen's own tags (and older ones): a category can't take them, or its tag
// would be the same tag (e.g. a "Junk" category would look like Preen's junk verdict).
const RESERVED_CATEGORY_NAMES = new Set(['other', 'person', 'real person', 'service', 'needs reply', 'to-do', 'to do', 'todo', 'review', 'processed', 'sensitive', 'junk']);
const CATEGORY_ACTIONS = ['flag', 'markUnread'];
const BOOLEAN_GROUPS = ['categorySort', 'questions', 'localChecks', 'actions', 'markProcessed', 'debug', 'telemetry'];
export const TRIGGERS = ['realtime', 'scheduled', 'manual'];

// [path, min, max, label] for whole-number settings.
const INTEGER_RANGES = [
  ['automation.intervalMinutes', 5, 1440, 'Schedule interval (minutes)'],
  ['automation.maxAgeDays', 1, 365, 'Maximum message age (days)'],
  ['limits.dailyMessages', 0, 1_000_000, 'Messages per day'],
  ['history.retentionDays', 1, 3650, 'History: days to keep'],
];

/** Returns a complete settings object: stored values over the defaults. */
export function mergeWithDefaults(stored) {
  const merged = structuredClone(DEFAULT_SETTINGS);
  if (!stored || typeof stored !== 'object') return merged;
  for (const key of Object.keys(merged)) {
    if (!(key in stored)) continue;
    const def = merged[key];
    const value = stored[key];
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      const known = Object.entries(value && typeof value === 'object' ? value : {}).filter(([k]) => k in def);
      merged[key] = { ...def, ...structuredClone(Object.fromEntries(known)) };
    } else {
      merged[key] = structuredClone(value);
    }
  }
  for (const c of Array.isArray(merged.categories) ? merged.categories : []) {
    const a = c?.actions;
    if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
    for (const k of Object.keys(a)) if (!CATEGORY_ACTIONS.includes(k)) delete a[k];
    if (Object.keys(a).length === 0) delete c.actions;
  }
  return merged;
}

function isProbability(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

/** @returns {{ok: boolean, errors: string[]}} */
export function validateSettings(settings) {
  const errors = [];
  if (!PROVIDERS[settings.provider]) errors.push(`Unknown provider "${settings.provider}".`);
  if (typeof settings.model !== 'string') errors.push('Model must be text.');
  if (!APPEARANCES.includes(settings.appearance)) errors.push('Appearance must be Match Thunderbird, Light or Dark.');
  const price = settings.pricePerMillionInputTokens;
  if (price !== null && !(typeof price === 'number' && Number.isFinite(price) && price >= 0)) {
    errors.push('Price per million tokens must be empty or a number of 0 or more.');
  }

  const maxLength = DESCRIPTION_LIMIT;

  // Personal context is sent with every request, so it shares the description limit.
  if (typeof settings.personalContext !== 'string') errors.push('Personal context must be text.');
  else if (settings.personalContext.trim().length > maxLength) {
    errors.push(`Personal context is longer than ${maxLength} characters.`);
  }

  if (typeof settings.recipientLanguages !== 'string') errors.push('Languages I read must be text.');
  else if (settings.recipientLanguages.trim().length > MAX_LANGUAGES_LENGTH) {
    errors.push(`Languages I read is longer than ${MAX_LANGUAGES_LENGTH} characters.`);
  }
  if (typeof settings.recipientLanguagesSet !== 'boolean') errors.push('Languages I read: "set" must be true or false.');

  const categories = settings.categories;
  const categoriesOn = settings.categorySort?.enabled !== false;
  // With categories off, the rows are kept as they are but not checked: they're hidden and not sent.
  // Something must still be asked, or a request would have no question in it.
  const anyQuestion = Object.values(settings.questions ?? {}).some((on) => on === true);
  if (!categoriesOn && !anyQuestion) {
    errors.push('With categories off, turn on at least one yes/no question (real person, needs reply, to-do or junk).');
  }
  if (!Array.isArray(categories) || (categories.length === 0 && categoriesOn)) {
    errors.push('Add at least one category.');
  } else if (categoriesOn) {
    if (categories.length > MAX_CATEGORIES) errors.push(`Use at most ${MAX_CATEGORIES} categories.`);
    const seen = new Set();
    const keys = new Map(); // tag key → category name
    for (const reserved of RESERVED_CATEGORY_NAMES) keys.set(tagKey(reserved), reserved);
    categories.forEach((c, i) => {
      const label = `Category ${i + 1}`;
      const name = typeof c?.name === 'string' ? c.name.trim() : '';
      if (!name) {
        errors.push(`${label} needs a name.`);
        return;
      }
      if (name.length > MAX_NAME_LENGTH) errors.push(`${label} name is longer than ${MAX_NAME_LENGTH} characters.`);
      if (/[/"]/.test(name)) errors.push(`${label} name can't contain / or ".`);
      const reserved = RESERVED_CATEGORY_NAMES.has(name.toLowerCase());
      if (reserved) errors.push(`"${name}" is a reserved name.`);
      if (seen.has(name.toLowerCase())) errors.push(`Category "${name}" appears twice.`);
      seen.add(name.toLowerCase());
      if (typeof c.description !== 'string' || !c.description.trim()) {
        errors.push(`Category "${name}" needs a description of what it is.`);
      } else if (c.description.trim().length > maxLength) {
        errors.push(`Category "${name}": "is" is longer than ${maxLength} characters.`);
      }
      if (c.excludes !== undefined) {
        if (typeof c.excludes !== 'string') errors.push(`Category "${name}": "is not" must be text.`);
        else if (c.excludes.trim().length > maxLength) {
          errors.push(`Category "${name}": "is not" is longer than ${maxLength} characters.`);
        }
      }
      const key = tagKey(name);
      if (reserved) {
        // Already reported as reserved.
      } else if (!key) errors.push(`Category "${name}" needs at least one letter or digit.`);
      else if (keys.has(key)) errors.push(`Categories "${keys.get(key)}" and "${name}" are too similar.`);
      else keys.set(key, name);
      if (c.threshold !== undefined && !isProbability(c.threshold)) {
        errors.push(`Category "${name}": certainty required must be between 0 and 1.`);
      }
      if (c.noToDo !== undefined && typeof c.noToDo !== 'boolean') {
        errors.push(`Category "${name}": "Never a To-do" must be on or off.`);
      }
      if (c.actions !== undefined) {
        const a = c.actions;
        if (!a || typeof a !== 'object' || Array.isArray(a)) {
          errors.push(`Category "${name}" actions must be an object.`);
        } else {
          for (const [k, v] of Object.entries(a)) {
            if (!CATEGORY_ACTIONS.includes(k)) errors.push(`Category "${name}" has an unknown action "${k}".`);
            else if (typeof v !== 'boolean') errors.push(`Category "${name}" action "${k}" must be true or false.`);
          }
        }
      }
    });
  }

  const t = settings.thresholds ?? {};
  for (const key of Object.keys(DEFAULT_SETTINGS.thresholds)) {
    if (!isProbability(t[key])) errors.push(`Threshold "${key}" must be between 0 and 1.`);
  }

  if (typeof settings.dryRun !== 'boolean') errors.push('Dry run must be on or off.');
  for (const group of BOOLEAN_GROUPS) {
    for (const [k, v] of Object.entries(settings[group] ?? {})) {
      if (typeof v !== 'boolean') errors.push(`Setting "${group}.${k}" must be true or false.`);
    }
  }

  for (const [path, min, max, label] of INTEGER_RANGES) {
    const v = getPath(settings, path);
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
  }
  const automation = settings.automation ?? {};
  if (typeof automation.enabled !== 'boolean') errors.push('Automatic processing must be paused or not (true or false).');
  if (typeof automation.unreadOnly !== 'boolean') errors.push('"Unread only" must be on or off.');
  if (!TRIGGERS.includes(automation.trigger)) errors.push(`Unknown trigger "${automation.trigger}".`);
  const cost = settings.limits?.monthlyCostUsd;
  if (cost !== null && !(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0)) {
    errors.push('Estimated monthly cost limit must be empty or a number of 0 or more.');
  } else if (cost !== null && typeof settings.pricePerMillionInputTokens !== 'number') {
    errors.push('The estimated monthly cost limit needs a price per million input tokens.');
  }
  const accounts = settings.scope?.accounts;
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) {
    errors.push('Account settings are invalid.');
  } else {
    for (const [id, a] of Object.entries(accounts)) {
      const paths = a?.folderPaths ?? [];
      if (!a || typeof a.enabled !== 'boolean' || !FOLDER_SCOPES.includes(a.folders)
        || !Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) {
        errors.push(`Settings for account ${id} are invalid.`);
      } else if (a.enabled && a.folders === 'selected' && paths.length === 0) {
        errors.push(`Choose at least one folder for account ${id}, or pick a different folder option.`);
      }
      if (a?.type !== undefined && a.type !== '' && !(a.type in ACCOUNT_TYPES)) {
        errors.push(`Unknown account type "${a.type}" for account ${id}.`);
      }
      if (a?.note !== undefined && (typeof a.note !== 'string' || a.note.trim().length > maxLength)) {
        errors.push(`The note for account ${id} must be text of at most ${maxLength} characters.`);
      }
    }
  }

  if (typeof settings.telemetry?.enabled !== 'boolean') errors.push('Anonymous usage statistics must be on or off.');
  if (!SPEEDS.includes(settings.speed)) errors.push(`Speed must be one of: ${SPEEDS.join(', ')}.`);

  const depth = settings.depth ?? {};
  if (!DEPTH_MODES.includes(depth.default)) errors.push(`Unknown default depth "${depth.default}".`);
  if (!depth.accounts || typeof depth.accounts !== 'object' || Array.isArray(depth.accounts)) {
    errors.push('Per-account depth settings are invalid.');
  } else {
    for (const [account, mode] of Object.entries(depth.accounts)) {
      if (!DEPTH_MODES.includes(mode)) errors.push(`Unknown depth "${mode}" for account ${account}.`);
    }
  }

  const consent = settings.consent;
  const when = consent?.sendToProvider;
  if (!consent || typeof consent !== 'object'
    || !(when === null || (typeof when === 'string' && !Number.isNaN(Date.parse(when)) && /^\d{4}-\d\d-\d\dT/.test(when)))
    || !(consent.provider === null || typeof consent.provider === 'string')) {
    errors.push('Consent to send mail is invalid.');
  }
  return { ok: errors.length === 0, errors };
}
