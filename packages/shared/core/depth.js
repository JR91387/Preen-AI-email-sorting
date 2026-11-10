// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Analysis depth. Surface sends metadata only; Deep includes the message text.

export const DEPTH_MODES = ['surface', 'deep'];

export const DEPTH_LABELS = {
  surface: 'Surface',
  deep: 'Deep',
};

// One line for each depth, short enough to show under a dropdown.
export const DEPTH_SHORT = {
  surface: 'Sender, subject and headers only. Never sends the message text.',
  deep: 'Adds the message text, in one request. Most accurate.',
};

/** The depth for an account: its own setting, or the default. */
export function depthForAccount(settings, accountId) {
  const mode = accountId ? settings.depth.accounts?.[accountId] : undefined;
  if (DEPTH_MODES.includes(mode)) return mode;
  return settings.depth.default;
}

/**
 * Runs the one request for the depth mode.
 *
 * @param {object} args
 * @param {'surface'|'deep'} args.mode
 * @param {(body: {text: string, truncated: boolean}|null) => Promise<object>} args.ask
 *   sends a request (without the body when `body` is null) and returns the response
 * @param {() => Promise<{text: string, truncated: boolean}|{skipped: string}>} args.loadBody
 * @returns {Promise<{final: object, decidedBy: 'surface'|'full',
 *   passes: {kind: string, response: object}[], notes: string[], body: object|null,
 *   textSkipped: string|null}>} textSkipped: why the text wasn't sent (Deep only)
 */
export async function runPasses({ mode, ask, loadBody }) {
  const passes = [];
  const notes = [];
  let textSkipped = null;
  const result = (final, decidedBy, body = null) => ({ final, decidedBy, passes, notes, body, textSkipped });

  if (mode === 'deep') {
    const body = await loadBody();
    if (body.skipped) {
      notes.push(`Message text not sent: ${body.skipped}`);
      textSkipped = body.skipped;
    } else {
      const response = await ask(body);
      passes.push({ kind: 'full', response });
      return result(response, 'full', body);
    }
  }
  const response = await ask(null);
  passes.push({ kind: 'surface', response });
  return result(response, 'surface');
}
