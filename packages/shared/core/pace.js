// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Speed: how hard Preen works during a run, so large folders go easy on the
// computer. High is today's pace; Medium (default) and Low go one message at a time
// with a pause after each one sent to Jev; Off removes the limit (discouraged).
// runSize is how many waiting messages one automatic run takes, newest first.

export const SPEEDS = ['low', 'medium', 'high', 'off'];
export const PACE = {
  low: { parallel: 1, pauseMs: 2000, runSize: 10 },
  medium: { parallel: 1, pauseMs: 500, runSize: 25 },
  high: { parallel: 2, pauseMs: 0, runSize: 50 },
  off: { parallel: 3, pauseMs: 0, runSize: 100 },
};

/** The pace for the user's Speed setting (Medium when missing or unknown). */
export function paceFor(settings) {
  return PACE[settings?.speed] ?? PACE.medium;
}

/**
 * Waits `ms` between messages, in short steps so a Stop (or any `cancelled()`
 * becoming true) ends the wait at once.
 */
export async function pause(ms, cancelled = () => false) {
  const end = Date.now() + ms;
  while (Date.now() < end && !cancelled()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, end - Date.now())));
  }
}
