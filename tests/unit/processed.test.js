// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessenger } from '../mocks/messenger.js';
import { recordProcessed, PROCESSED_KEY } from '../../apps/thunderbird/storage/processed.js';

test('recording keeps every entry under the cap and drops the oldest only over it', async () => {
  const env = createMessenger({ messages: {} });
  globalThis.messenger = env.messenger;
  await recordProcessed(['a|1', '', 'a|2']);
  assert.deepEqual(Object.keys((await env.messenger.storage.local.get(PROCESSED_KEY))[PROCESSED_KEY]), ['a|1', 'a|2']);

  const old = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`old|${i}`, i + 1]));
  await env.messenger.storage.local.set({ [PROCESSED_KEY]: old });
  await recordProcessed(['new|1']);
  const record = (await env.messenger.storage.local.get(PROCESSED_KEY))[PROCESSED_KEY];
  assert.equal(Object.keys(record).length, 20000);
  assert.ok(record['new|1']);
  assert.equal(record['old|0'], undefined, 'the oldest entry is the one dropped');
  assert.ok(record['old|1']);
  delete globalThis.messenger;
});
