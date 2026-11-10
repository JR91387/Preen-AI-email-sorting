// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Prepares email body text for classification: removes quoted replies and
// signatures, tidies whitespace and cuts to a length limit.

// Lines where everything from that point on is a quoted earlier message.
const QUOTE_START_PATTERNS = [
  /^On [^\n]{0,300}?(\n[^\n]{0,200}?)?wrote:[ \t]*$/m, // "On <date>, <name> wrote:" (may wrap)
  /^-{2,}\s*Original Message\s*-{2,}[ \t]*$/im, // Outlook
  /^-{2,}\s*Forwarded message\s*-{2,}[ \t]*$/im, // Gmail forward
  /^_{10,}[ \t]*\n(From|De|Von):/m, // Outlook separator line followed by From:
];

const SIGNATURE_DELIMITER = /^-- ?$/m; // standard "-- " signature line

function cutAt(text, pattern) {
  const match = pattern.exec(text);
  return match ? text.slice(0, match.index) : text;
}

/** Removes quoted history, signature and extra whitespace. */
export function cleanBody(text) {
  let out = String(text ?? '').replace(/\r\n?/g, '\n');
  for (const pattern of QUOTE_START_PATTERNS) out = cutAt(out, pattern);
  out = cutAt(out, SIGNATURE_DELIMITER);
  out = out
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .map((line) => line.replace(/[ \t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

/**
 * Cuts text to at most `max` characters, preferring a word boundary.
 * @returns {{text: string, truncated: boolean}}
 */
export function truncate(text, max) {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const lastSpace = cut.search(/\s\S*$/);
  if (lastSpace > max * 0.9) cut = cut.slice(0, lastSpace);
  return { text: cut.trimEnd(), truncated: true };
}
