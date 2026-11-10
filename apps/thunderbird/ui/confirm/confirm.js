// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Asks before a large right-click, folder or popup run. The background script
// stores the run and opens this window; only "Classify all" starts it, so
// closing the window runs nothing (the stored run is replaced by the next one).

import { CONFIRM_RESULT } from '../../core/protocol.js';
import { formatTokens } from '../../core/cost.js';
import { $ } from '../shared/ui.js';

const params = new URLSearchParams(location.search);
const id = params.get('id');
const count = Number(params.get('count'));
const tokens = Number(params.get('tokens'));
const apply = params.get('apply') === '1';

$('title').textContent = apply ? 'Classify these messages?' : 'Preview these messages?';
$('summary').textContent = `${count.toLocaleString()} messages selected.`;
$('estimate').textContent = tokens > 0
  ? `About ${formatTokens(tokens)} tokens, based on your average so far.`
  : 'No token estimate yet: Preen hasn’t classified anything this month.';
$('ok').textContent = apply ? 'Classify all' : 'Preview all';

// window.close() is ignored for a window opened with windows.create, so the
// window is closed (and sized) through the windows API, with close() as a fallback.
async function closeWindow() {
  try {
    const current = await messenger.windows.getCurrent();
    await messenger.windows.remove(current.id);
  } catch {
    window.close();
  }
}

async function fitWindow() {
  try {
    const current = await messenger.windows.getCurrent();
    const frame = window.outerHeight - window.innerHeight; // title bar and borders
    const height = Math.ceil(document.documentElement.scrollHeight + frame + 8);
    if (height > window.outerHeight) await messenger.windows.update(current.id, { height });
  } catch {
    // The generous first size still shows the buttons on most setups.
  }
}

let answered = false;
async function answer(ok) {
  if (answered) return;
  answered = true;
  try {
    // The background starts the run and replies at once; the window then closes.
    await messenger.runtime.sendMessage({ type: CONFIRM_RESULT, id, ok });
  } finally {
    await closeWindow();
  }
}
$('ok').addEventListener('click', () => answer(true));
$('cancel').addEventListener('click', () => answer(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') answer(false); });
fitWindow();
