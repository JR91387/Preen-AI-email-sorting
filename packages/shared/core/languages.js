// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The "Languages I read" hint: a first guess from the user's own language
// settings, so a newcomer doesn't start with an empty box.

export const MAX_LANGUAGES_LENGTH = 200;

/**
 * Readable, de-duplicated language names for language tags, e.g.
 * ['en-US', 'en', 'es'] → "English (United States), Spanish".
 * A bare language ("en") is dropped when a regional form of it ("en-US") is
 * already listed. Tags the runtime can't name are skipped.
 *
 * @param {string[]} tags BCP 47 tags, most preferred first
 * @param {(tag: string) => string|undefined} [nameOf] defaults to Intl.DisplayNames in English
 */
export function languageNames(tags, nameOf = defaultNameOf()) {
  const seen = new Set();
  const entries = [];
  for (const raw of tags) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const tag = raw.trim();
    let name;
    try {
      name = nameOf(tag);
    } catch {
      continue; // not a valid language tag
    }
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push({ language: tag.split(/[-_]/)[0].toLowerCase(), regional: /[-_]/.test(tag), name });
  }
  const regionalOf = new Set(entries.filter((e) => e.regional).map((e) => e.language));
  return entries.filter((e) => e.regional || !regionalOf.has(e.language)).map((e) => e.name);
}

function defaultNameOf() {
  if (typeof Intl === 'undefined' || !Intl.DisplayNames) return () => undefined;
  const names = new Intl.DisplayNames(['en'], { type: 'language', languageDisplay: 'standard' });
  return (tag) => names.of(tag);
}

/**
 * The text to pre-fill the field with, or '' when the user has already chosen
 * (even if they chose to leave it empty).
 *
 * @param {{recipientLanguages: string, recipientLanguagesSet: boolean}} settings
 * @param {{uiLanguage?: string, languages?: string[]}} env the browser's language settings
 */
export function suggestedLanguages(settings, env, nameOf) {
  if (settings.recipientLanguagesSet || settings.recipientLanguages.trim()) return '';
  const tags = [env.uiLanguage, ...(env.languages ?? [])].filter(Boolean);
  const names = languageNames(tags, nameOf);
  // Whole names only: cut the list rather than a name in half.
  let text = '';
  for (const name of names) {
    const next = text ? `${text}, ${name}` : name;
    if (next.length > MAX_LANGUAGES_LENGTH) break;
    text = next;
  }
  return text;
}
