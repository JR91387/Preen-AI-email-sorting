// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Classifies messages: read metadata → sender rules → ask Jev (with or
// without the body, depending on the account's depth mode) → decide →
// apply (unless previewing or in dry run) → log. Every API call counts
// toward the usage limits, whether the run is manual or automatic.

import { loadSettings, readConsent } from '../storage/settings.js';
import { appendEntries, appendDebug } from '../storage/activity-log.js';
import { modelChangeNotice } from '../core/selfcheck.js';
import { validateSettings, MAX_BODY_CHARS } from '../core/settings-schema.js';
import { cleanBody, truncate } from '../core/text.js';
import { headerSignals } from '../core/headers.js';
import { buildRequest } from '../core/questions.js';
import { decide } from '../core/rules.js';
import { costFromUsage } from '../core/cost.js';
import { mapWithConcurrency } from '../core/concurrency.js';
import { depthForAccount, runPasses } from '../core/depth.js';
import { presetPerson } from '../core/sender-rules.js';
import { extractAddress } from '../core/headers.js';
import { classifyWith, resolveProvider } from '../providers/index.js';
import { getEmailMeta, getEmailBody } from '../mail/messages.js';
import { createContactLookup } from '../mail/contacts.js';
import { ensureTags, managedTagKeys } from '../mail/tags.js';
import { applyDecision } from '../mail/actions.js';
import { planUpdate } from '../core/actions.js';
import { recordProcessed, recordDryRunSeen, processedKey, readCorrected } from '../storage/processed.js';
import { readUsage, saveUsage } from '../storage/state.js';
import { readOverrides } from '../storage/overrides.js';
import { addUsage, budgetStatus } from '../core/budget.js';
import { withRetries } from '../core/retry.js';
import { detectSensitive, sensitiveReason, replaceSensitive } from '../core/sensitive.js';
import { paceFor, pause } from '../core/pace.js';
import { RUN_PROGRESS_KEY } from '../core/protocol.js';
import { createSerializer } from '../core/serialize.js';
import { STOPPED_AFTER_ERROR, LIMIT_REACHED, AWAITING_CONSENT, CORRECTED } from '../core/run-summary.js';
import { hasConsent, waitingForConsent } from '../core/consent.js';

// Errors that will repeat for every remaining message: stop the batch.
const BATCH_STOPPING_ERRORS = new Set(['auth', 'bad_request']);

export class SetupError extends Error {}

async function checkSetup(settings) {
  const { ok, errors } = validateSettings(settings);
  if (!ok) throw new SetupError(`Settings need fixing: ${errors.join(' ')}`);
  if (!settings.apiKey) throw new SetupError('Add your API key in Preen settings first.');
  const { origin, label } = resolveProvider(settings);
  const granted = await messenger.permissions.contains({ origins: [origin] });
  if (!granted) {
    throw new SetupError(`Preen needs permission to contact ${label}. Open Preen settings and click "Test connection".`);
  }
}

function describePass(pass, settings) {
  const cost = costFromUsage(pass.response.usage, settings.pricePerMillionInputTokens);
  return {
    kind: pass.kind,
    model: pass.response.model,
    inputTokens: pass.response.usage.input_tokens ?? null,
    costUsd: cost?.usd ?? null,
    costSource: cost?.source ?? null,
    ms: typeof pass.response.ms === 'number' ? pass.response.ms : null,
    unsure: pass.unsure ?? [],
  };
}

/**
 * Records a finished message: as processed when changes are applied, or as
 * seen during dry run for automatic runs. Previews record nothing.
 */
async function rememberDone(meta, state) {
  const key = processedKey(meta.accountId, meta.headerMessageId);
  if (state.apply) await recordProcessed([key]);
  else if (state.source === 'automatic') await recordDryRunSeen([key]);
}

/** Debug mode: one record per exchange with Jev, with Preen's decision and the settings used. */
async function saveDebug(exchanges, entry, settings, decision, applied) {
  const snapshot = { ...settings };
  delete snapshot.apiKey;
  // What Preen would change on an unflagged, read message; the actual changes when applied.
  const actions = decision ? (applied?.changes ?? planUpdate({ tags: [], read: true }, decision, settings).changes) : null;
  const summary = decision ? { category: decision.category, tags: decision.tags, review: decision.review, toDo: decision.toDo, sensitive: decision.sensitive === true, junk: decision.junk, actions } : null;
  const records = exchanges.map((x) => ({
    ...x, entryId: entry.debugId, key: entry.headerMessageId ?? null, provider: settings.provider, decision: summary, settings: snapshot,
  }));
  await appendDebug(records).catch((e) => console.warn('Preen: could not save the debug log', e));
}

async function classifyOne(messageId, settings, state) {
  const entry = {
    at: new Date().toISOString(), runId: state.runId, messageId, dryRun: !state.apply, runKind: state.runKind, source: state.source,
  };
  if (state.stopped) return { ...entry, skipped: STOPPED_AFTER_ERROR };
  if (state.generation !== stopGeneration) return { ...entry, skipped: STOPPED_BY_USER };
  // Messages already in progress count against the daily message limit: two run at
  // once, and without this each would pass the check before the other's use was counted.
  const inFlight = state.inFlight ?? 0;
  const budget = budgetStatus({ ...state.usage, dayMessages: state.usage.dayMessages + inFlight }, settings);
  if (!budget.canRun) return { ...entry, skipped: LIMIT_REACHED, limitReason: budget.reason };
  state.inFlight = inFlight + 1;
  let reserved = true;
  // Released once: when this message's use is counted, or when it ends without API use.
  const release = () => {
    if (reserved) {
      reserved = false;
      state.inFlight -= 1;
    }
  };
  const exchanges = settings.debug.enabled ? [] : null;
  const onExchange = exchanges && ((x) => exchanges.push(x));
  if (exchanges) entry.debugId = `${state.runId}:${messageId}`;
  let decision = null;
  let applied = null;
  try {
    const meta = await getEmailMeta(messageId);
    entry.headerMessageId = meta.headerMessageId;
    // Kept locally so the activity log and exports are readable on their own.
    // The message text is never stored.
    entry.from = meta.author ?? '';
    entry.subject = meta.subject ?? '';
    // The user changed Preen's tags on this message: leave it alone unless asked to.
    if (state.corrected?.[processedKey(meta.accountId, meta.headerMessageId)] && !state.anyway.has(messageId)) {
      return { ...entry, skipped: CORRECTED };
    }
    if (meta.skipped) {
      // Can never be classified (e.g. encrypted): remember it so scans skip it.
      await rememberDone(meta, state);
      return { ...entry, skipped: meta.skipped };
    }

    const mode = depthForAccount(settings, meta.accountId);
    const signals = headerSignals(meta.headers, meta.author);
    const sender = extractAddress(meta.author);
    const senderRule = state.overrides[sender] ?? null;
    const lookup = sender ? await state.lookupContact(sender) : null;
    const preset = presetPerson(settings, senderRule);
    const known = preset.person ? { person: preset.person } : {};

    const ask = (body) => {
      let email = { ...meta, senderIsContact: lookup ?? 'unknown' };
      if (body) email = { ...email, body: body.text, bodyTruncated: body.truncated };
      if (settings.localChecks.replacePii) {
        email = { ...email, subject: replaceSensitive(email.subject) };
      }
      const request = buildRequest(email, settings, signals, known);
      return withRetries(() => classifyWith(settings, request, undefined, onExchange));
    };
    let rawRead = null;
    const readRaw = () => (rawRead ??= getEmailBody(messageId, meta.size));
    let bodyRead = null;
    const loadBody = () => (bodyRead ??= (async () => {
      const raw = await readRaw();
      if (raw.skipped) return raw;
      // Replace on the whole cleaned text, then cut, so a number split by the cut can't escape.
      const cleaned = cleanBody(raw.text);
      const body = truncate(settings.localChecks.replacePii ? replaceSensitive(cleaned) : cleaned, MAX_BODY_CHARS);
      return body.text ? body : { skipped: 'no readable text' };
    })());

    // Read fresh for every message, so withdrawing consent stops a run at once.
    const consent = await readConsent();
    if (!hasConsent({ ...settings, consent })) {
      return { ...entry, skipped: AWAITING_CONSENT, consentReason: waitingForConsent(resolveProvider(settings).label) };
    }
    const run = await runPasses({ mode, ask, loadBody });

    decision = decide(run.final.answers, settings, known);
    if (preset.reason) decision.reasons.unshift(preset.reason);
    if (settings.localChecks.sensitive) {
      // Local patterns only, on this computer: the subject plus the full message text, at every depth.
      const raw = await readRaw().catch(() => ({}));
      const kinds = detectSensitive(`${meta.subject ?? ''}\n${raw.text ?? ''}`);
      if (kinds.length) {
        decision.sensitive = true;
        decision.reasons.push(sensitiveReason(kinds));
      }
    }
    const passes = run.passes.map((p) => describePass(p, settings));

    let applyError = null;
    if (state.apply) {
      try {
        applied = await applyDecision(messageId, decision, settings, state.managedTags);
      } catch (e) {
        console.error('Preen: could not update message', e);
        applyError = e.message;
      }
    }
    // A failed update isn't recorded, so the scheduler can retry it.
    if (!applyError) await rememberDone(meta, state);

    const result = {
      ...entry,
      applied,
      applyError,
      mode,
      provider: settings.provider,
      decidedBy: run.decidedBy,
      ...(run.textSkipped ? { textSkipped: run.textSkipped } : {}),
      passes,
      model: run.final.model,
      category: decision.category,
      tags: decision.tags,
      review: decision.review,
      toDo: decision.toDo,
      sensitive: decision.sensitive === true,
      junk: decision.junk,
      reasons: [...decision.reasons, ...run.notes],
      scores: decision.scores,
      signals,
      bodyChars: run.body ? run.body.text.length : 0,
      truncated: run.body ? run.body.truncated : false,
      inputTokens: passes.reduce((sum, p) => sum + (p.inputTokens ?? 0), 0),
      // Cost only when known for every pass; otherwise tokens tell the story.
      costUsd: passes.every((p) => p.costUsd !== null) ? passes.reduce((sum, p) => sum + p.costUsd, 0) : null,
      costSource: passes.every((p) => p.costSource === 'provider') ? 'provider' : (passes[0]?.costSource ?? null),
    };
    // Saved after every message, so nothing is lost if Thunderbird suspends
    // the background script mid-run.
    release();
    addUsage(state.usage, result);
    await saveUsage(state.usage);
    return result;
  } catch (e) {
    const kind = e.kind ?? 'internal';
    if (BATCH_STOPPING_ERRORS.has(kind)) state.stopped = true;
    if (kind === 'internal') console.error('Preen: classification failed', e);
    return { ...entry, error: { kind, message: e.message } };
  } finally {
    release();
    if (exchanges?.length) await saveDebug(exchanges, entry, settings, decision, applied);
  }
}

// One classification batch at a time, so usage counts stay accurate.
const serializedRun = createSerializer();

// The Stop button: every run requested before the click stops, including runs
// still waiting their turn. Runs requested afterwards are unaffected.
export const STOPPED_BY_USER = 'stopped by you';
let stopGeneration = 0;
export function stopRuns() {
  stopGeneration++;
}
// Results are written to the history in small batches as messages finish, so an
// export mid-run shows progress and closing Thunderbird loses little.
const LOG_EVERY = 5;
// The run in progress, for the Activity page's progress line: { runId, kind, done, total }.
// A failed progress write is ignored: the progress line is cosmetic and must not fail the run.
const setProgress = (value) => messenger.storage.local.set({ [RUN_PROGRESS_KEY]: value }).catch(() => {});

/**
 * Classifies messages and appends the results to the activity log.
 * @param {number[]} messageIds
 * @param {object} [options]
 * @param {boolean} [options.apply] change the messages, unless dry run is on
 *   in settings. Without it, this is a preview.
 * @param {'manual'|'automatic'} [options.source] what started the run
 * @param {number[]} [options.anyway] messages to classify even though the user corrected them
 *   (Classify anyway). Previews never skip corrected messages.
 * @returns {Promise<object[]>} one activity entry per message
 */
export function classifyMessages(messageIds, { apply = false, source = 'manual', anyway = [] } = {}) {
  const generation = stopGeneration;
  return serializedRun(() => classifyBatch(messageIds, { apply, source, generation, anyway }));
}

const LAST_MODEL_KEY = 'lastModel';

/** One notice when answers come from a different model than before (thresholds were tuned on the old one). */
async function noteModelChange(results) {
  const current = results.map((r) => r.model).filter(Boolean).pop();
  if (!current) return;
  const { [LAST_MODEL_KEY]: previous } = await messenger.storage.local.get(LAST_MODEL_KEY);
  if (previous === current) return;
  await messenger.storage.local.set({ [LAST_MODEL_KEY]: current });
  const notice = modelChangeNotice(previous, current);
  if (notice) await appendEntries([{ at: new Date().toISOString(), notice }]);
}

async function classifyBatch(messageIds, { apply, source, generation = stopGeneration, anyway = [] }) {
  // A run that ended abnormally (Thunderbird closed mid-run) may have left its progress behind.
  await setProgress(null);
  const settings = await loadSettings();
  await checkSetup(settings);
  const state = {
    runId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    stopped: false,
    generation,
    apply: apply && !settings.dryRun,
    // 'applied', 'dry run' (asked to apply, but dry run is on) or 'preview'
    runKind: apply ? (settings.dryRun ? 'dry run' : 'applied') : 'preview',
    source,
    usage: await readUsage(),
    overrides: await readOverrides(),
    lookupContact: createContactLookup(),
    // Previews change nothing, so they run on corrected messages too.
    corrected: apply ? await readCorrected() : null,
    anyway: new Set(anyway),
  };
  if (state.apply) {
    try {
      await ensureTags(settings);
    } catch (e) {
      // Reported like other setup problems; automatic runs keep their queue.
      throw new SetupError(`Could not set up Preen's tags in Thunderbird: ${e.message}`);
    }
    state.managedTags = await managedTagKeys(settings);
  }
  // Automatic runs retry limit- and consent-skipped messages later; logging them each time would be noise.
  // Messages a Stop skipped are summed up in one notice instead of a row each.
  const loggable = (r) => r.skipped !== STOPPED_BY_USER
    && !(source === 'automatic' && (r.skipped === LIMIT_REACHED || r.skipped === AWAITING_CONSENT));
  try {
    const pending = [];
    let written = Promise.resolve();
    // Every save is caught as it happens (an uncaught one would be an unhandled error
    // while the run goes on); the first failure is reported when the run ends.
    let writeError = null;
    const save = (entries) => {
      written = appendEntries(entries).catch((e) => { writeError ??= e; });
    };
    let done = 0;
    const total = messageIds.length;
    const progress = () => setProgress({ runId: state.runId, kind: state.runKind, done, total });
    const flush = () => {
      if (pending.length) save(pending.splice(0));
      progress();
    };
    progress();
    const pace = paceFor(settings);
    const results = await mapWithConcurrency(messageIds, pace.parallel, async (id) => {
      const result = await classifyOne(id, settings, state);
      // Speed: a short rest after each message sent to Jev, not after skips.
      // No rest after the last message, and none once Stop is pressed.
      if (result.passes?.length && done + 1 < total) await pause(pace.pauseMs, () => state.generation !== stopGeneration);
      done++;
      if (loggable(result)) {
        // The run's first logged entry counts the run once in the monthly statistics.
        if (!state.runCounted) {
          state.runCounted = true;
          result.runStart = true;
        }
        pending.push(result);
        if (pending.length >= LOG_EVERY) flush();
      }
      return result;
    });
    flush();
    const stopped = results.filter((r) => r.skipped === STOPPED_BY_USER).length;
    if (stopped) {
      save([{ at: new Date().toISOString(), runId: state.runId, notice: `Stopped: ${stopped} message${stopped === 1 ? ' was' : 's were'} not classified.` }]);
    }
    await written;
    if (writeError) throw writeError;
    await noteModelChange(results);
    await appendEntries([], settings.history); // retention, once per run
    return results;
  } finally {
    await setProgress(null);
  }
}
