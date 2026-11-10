// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The popup says roughly what classifying or previewing several selected messages costs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUpPage, waitFor } from './page-env.js';
import { appendEntries } from '../../apps/thunderbird/storage/activity-log.js';

const { document, env } = setUpPage('popup/popup');
await env.messenger.storage.local.set({ settings: { apiKey: 'k', pricePerMillionInputTokens: 1 } });
const at = new Date().toISOString();
await appendEntries([1, 2].map(() => ({ at, scores: {}, inputTokens: 1000, category: 'Work', tags: [] })));
env.messenger.mailTabs.getSelectedMessages = async () => ({ id: null, messages: [1, 2, 3, 4, 5].map((id) => ({ id })) });
await import('../../apps/thunderbird/ui/popup/popup.js');
await waitFor(() => !document.getElementById('estimate').hidden);

test('with several messages selected the popup shows tokens and dollars as an estimate', () => {
  const t = document.getElementById('estimate').textContent;
  assert.match(t, /these 5 messages/);
  assert.match(t, /about 5k tokens/);
  assert.match(t, /about \$0\.005/);
  assert.match(t, /estimate/);
});
