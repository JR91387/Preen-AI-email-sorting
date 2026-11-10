// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// What a run left undone, in words: messages a run never classified must not
// look like "nothing found". Two kinds: skipped at a limit, and left over when the
// run stopped after an error (e.g. a rejected API key). Messages the user stopped,
// and ones that can never be read (encrypted, too large), aren't counted.

export const STOPPED_AFTER_ERROR = 'stopped after an earlier error';
export const LIMIT_REACHED = 'limit reached';
export const AWAITING_CONSENT = 'waiting for consent';
// The user changed Preen's tags on the message by hand; not a run left undone.
export const CORRECTED = 'You corrected this message';

/** The note after Classify left corrected messages alone. */
export function correctedText(count) {
  return `${count} skipped because you corrected ${count === 1 ? 'it' : 'them'}.`;
}

/**
 * @param {object[]} results one entry per message, as classifyMessages returns them
 * @returns {{count: number, total: number, reason: string, kind: 'limit'|'consent'|'error', text: string}|null}
 *   null when nothing was left undone
 */
export function skipSummary(results) {
  const all = results ?? [];
  const limited = all.filter((r) => r?.skipped === LIMIT_REACHED);
  const halted = all.filter((r) => r?.skipped === STOPPED_AFTER_ERROR);
  const waiting = all.filter((r) => r?.skipped === AWAITING_CONSENT);
  const count = limited.length + halted.length + waiting.length;
  if (!count) return null;
  let kind;
  let reason;
  if (limited.length) {
    kind = 'limit';
    reason = limited.find((r) => r.limitReason)?.limitReason ?? 'A limit was reached';
  } else if (waiting.length) {
    kind = 'consent';
    reason = waiting[0].consentReason ?? 'Waiting for your OK to send mail';
  } else {
    kind = 'error';
    const error = all.find((r) => r?.error)?.error;
    reason = `Preen stopped after an error${error ? `: ${error.message}` : ''}`;
  }
  return {
    count,
    total: all.length,
    reason,
    kind,
    text: `${count} of ${all.length} message${all.length === 1 ? '' : 's'} ${count === 1 ? 'was' : 'were'} not processed. ${reason}`,
  };
}
