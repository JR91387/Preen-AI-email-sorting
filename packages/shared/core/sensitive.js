// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Sensitive-info flag: local patterns only, no model. Finds number-shaped
// personal data and returns only the kinds found, never the values; the same
// patterns can replace what they find before text is sent. Each pattern is
// validated (check digits, number ranges or a nearby label) to avoid false hits on
// order numbers, phone numbers and tracking codes. Not detected by design:
// details without a number shape, such as a diagnosis.

export const KINDS = {
  card: 'a payment card number',
  iban: 'a bank account number (IBAN)',
  ssn: 'a US Social Security number',
  dob: 'a date of birth',
  passport: 'a passport number',
  licence: "a driver's licence number",
};

// Luhn check digit, used by payment cards.
function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ISO 13616 IBAN check: move the first four characters to the end, letters → 10–35, mod 97 = 1.
function ibanValid(raw) {
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const value = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of value) rem = (rem * 10 + Number(digit)) % 97;
  }
  return rem === 1;
}

// SSA rules: area not 000, 666 or 900–999; group not 00; serial not 0000.
function ssnValid(area, group, serial) {
  const a = Number(area);
  return a !== 0 && a !== 666 && a < 900 && group !== '00' && serial !== '0000';
}

// Separators: space, tab, no-break spaces and dashes (never a line break: two numbers
// on separate lines must not join into one).
const SEP = '[ \\t\\u00A0\\u2009\\u202F\\u2010-\\u2012-]';
const CARD = new RegExp(`(?<![\\d-])(?:\\d${SEP}?){12,18}\\d(?![\\d-])`, 'g');
const IBAN = /\b[A-Z]{2}\d{2}(?:[ \u00A0]?[A-Z0-9]{4}){2,7}(?:[ \u00A0]?[A-Z0-9]{1,4})?\b/gi;
const SSN = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g;
const DATE = String.raw`(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} [A-Za-z]{3,9},? \d{4}|[A-Za-z]{3,9} \d{1,2},? \d{4})`;
const DOB = new RegExp(String.raw`\b(?:DOB|D\.O\.B\.|date of birth|birth ?date|born(?: on)?)\b[:\s]{0,3}${DATE}`, 'i');
const PASSPORT = /\bpassport(?: (?:no\.?|number|#))?[:\s#]{1,3}[A-Z0-9]{6,9}\b/i;
// A bare "DL" (download, distribution list…) needs an explicit number marker.
const LICENCE = /\b(?:driver'?s? licen[cs]e(?: (?:no\.?|number|#))?|DL (?:no\.?|number|#))[:\s#]{1,3}[A-Z0-9-]{5,15}\b/i;

// Major card networks start with 3, 4, 5 or 6; other long numbers are usually references.
function isCard(match) {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 && /^[3-6]/.test(digits) && luhn(digits);
}

/** The kinds of sensitive data found in `text` (each kind once, in KINDS order). */
export function detectSensitive(text) {
  const t = String(text ?? '');
  const found = new Set();
  for (const m of t.matchAll(CARD)) if (isCard(m[0])) found.add('card');
  for (const m of t.matchAll(IBAN)) if (ibanValid(m[0])) found.add('iban');
  for (const m of t.matchAll(SSN)) if (ssnValid(m[1], m[2], m[3])) found.add('ssn');
  if (DOB.test(t)) found.add('dob');
  if (PASSPORT.test(t)) found.add('passport');
  if (LICENCE.test(t)) found.add('licence');
  return Object.keys(KINDS).filter((k) => found.has(k));
}

export const PII_BLOCK = '<PII_Block>';

const globalOf = (re) => new RegExp(re.source, `${re.flags.replace('g', '')}g`);

/** `text` with every match the patterns above would report replaced by PII_BLOCK. */
export function replaceSensitive(text) {
  return String(text ?? '')
    .replace(CARD, (m) => (isCard(m) ? PII_BLOCK : m))
    .replace(IBAN, (m) => (ibanValid(m) ? PII_BLOCK : m))
    .replace(SSN, (m, a, g, s) => (ssnValid(a, g, s) ? PII_BLOCK : m))
    .replace(globalOf(DOB), PII_BLOCK)
    .replace(globalOf(PASSPORT), PII_BLOCK)
    .replace(globalOf(LICENCE), PII_BLOCK);
}

/** The reason line for a flagged message: names the kinds, never the values. */
export function sensitiveReason(kinds) {
  return `Sensitive: contains ${kinds.map((k) => KINDS[k]).join(', ')} (found on this computer)`;
}
