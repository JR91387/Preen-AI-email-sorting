// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Two depths: Surface (metadata only) and Deep (with the message text), each one request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_MODES, depthForAccount, runPasses } from '../../packages/shared/core/depth.js';
import { mergeWithDefaults } from '../../packages/shared/core/settings-schema.js';

const settings = mergeWithDefaults({ depth: { default: 'deep', accounts: { work: 'surface', home: 'deep' } } });

function answers({ cat = 'Receipts', p = 0.9, conf = 0.8, person = 0.05, reply = 0.1 } = {}) {
  return {
    category: { type: 'choice', choice: cat, probabilities: { [cat]: p }, confidence: conf },
    person: { type: 'noul', noul: person },
    needs_reply: { type: 'noul', noul: reply },
  };
}

const clear = { model: 'jev', answers: answers(), usage: { input_tokens: 400 } };
const unsure = { model: 'jev', answers: answers({ p: 0.5 }), usage: { input_tokens: 400 } };
const withText = { model: 'jev', answers: answers({ cat: 'Work', p: 0.95 }), usage: { input_tokens: 1200 } };

// A fake ask(): returns queued responses and records whether a body was sent.
function fakeAsk(...responses) {
  const calls = [];
  const ask = async (body) => {
    calls.push(body);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { ask, calls };
}

const bodyOk = async () => ({ text: 'Hello', truncated: false });
const bodyEncrypted = async () => ({ skipped: 'encrypted' });
const bodyMustNotLoad = async () => { throw new Error('body must not be read'); };

test('only Surface and Deep exist; Deep is the default', () => {
  assert.deepEqual(DEPTH_MODES, ['surface', 'deep']);
  assert.equal(mergeWithDefaults({}).depth.default, 'deep');
});

test('depthForAccount uses the per-account mode, else the default', () => {
  assert.equal(depthForAccount(settings, 'work'), 'surface');
  assert.equal(depthForAccount(settings, 'home'), 'deep');
  assert.equal(depthForAccount(settings, 'other'), 'deep');
  assert.equal(depthForAccount(settings, null), 'deep');
  const bad = mergeWithDefaults({ depth: { default: 'deep', accounts: { x: 'bogus' } } });
  assert.equal(depthForAccount(bad, 'x'), 'deep');
});

test('Surface: one metadata-only request, body never read, even when unsure', async () => {
  const { ask, calls } = fakeAsk(unsure);
  const run = await runPasses({ mode: 'surface', ask, loadBody: bodyMustNotLoad });
  assert.deepEqual(calls, [null]);
  assert.equal(run.decidedBy, 'surface');
  assert.equal(run.passes.length, 1);
});

test('Deep: one request with the body, never a second one', async () => {
  const { ask, calls } = fakeAsk(withText, clear);
  const run = await runPasses({ mode: 'deep', ask, loadBody: bodyOk });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'Hello');
  assert.equal(run.decidedBy, 'full');
  assert.equal(run.body.text, 'Hello');
});

test('Deep: falls back to metadata when the body is encrypted', async () => {
  const { ask, calls } = fakeAsk(clear);
  const run = await runPasses({ mode: 'deep', ask, loadBody: bodyEncrypted });
  assert.deepEqual(calls, [null]);
  assert.equal(run.decidedBy, 'surface');
  assert.match(run.notes[0], /not sent: encrypted/);
});

test('request errors propagate to the caller', async () => {
  const err = Object.assign(new Error('bad key'), { kind: 'auth' });
  for (const mode of DEPTH_MODES) {
    const { ask } = fakeAsk(err);
    await assert.rejects(runPasses({ mode, ask, loadBody: bodyOk }), err);
  }
});
