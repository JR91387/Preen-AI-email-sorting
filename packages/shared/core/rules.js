// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Jerry Reinitz | Midwest Software Engineer | Healthcare Intelligence, AI Agents, Rust, PostgreSQL & React | https://jerryreinitz.com
// Conceived, written and managed by Jerry Reinitz, in partnership with large language models from Anthropic (Claude).
// "Jev judges, code decides": turns Jev's probabilities into tags using the
// user's thresholds. When unsure, Preen does less, never more.

import { OTHER_CATEGORY } from './questions.js';
import { UNSURE_MARGIN } from './settings-schema.js';
import { TAG_NAME_PREFIX, REAL_PERSON_TAG, NEEDS_REPLY_TAG, JUNK_TAG } from './tags.js';

/** Reads the probability from a yes/no ("noul") answer. */
export function readNoul(answer) {
  if (!answer) return null;
  const value = answer.noul ?? answer.probability ?? answer.value;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;
}

/**
 * Maps the model's category label to a configured category name: exactly, or
 * else ignoring case and surrounding spaces. Returns 'other' for the "other"
 * option, and null for anything else (never trust a label we didn't offer).
 */
export function matchCategory(choice, settings) {
  if (typeof choice !== 'string' || !choice.trim()) return null;
  const label = choice.trim();
  if (label.toLowerCase() === OTHER_CATEGORY) return OTHER_CATEGORY;
  const names = settings.categories.map((c) => c.name.trim());
  return names.find((n) => n === label) ?? names.find((n) => n.toLowerCase() === label.toLowerCase()) ?? null;
}

/**
 * The probability the model gave its chosen label: looked up by the exact
 * label, then the trimmed label, then the configured name it matched.
 */
export function choiceProbability(cat, matched) {
  const probabilities = cat?.probabilities ?? {};
  const raw = typeof cat?.choice === 'string' ? cat.choice : null;
  for (const key of [raw, raw?.trim(), matched]) {
    if (key && typeof probabilities[key] === 'number') return probabilities[key];
  }
  const wanted = (matched ?? raw?.trim() ?? '').toLowerCase();
  for (const [key, value] of Object.entries(probabilities)) {
    if (wanted && key.trim().toLowerCase() === wanted && typeof value === 'number') return value;
  }
  return null;
}

/** The certainty required for a category: its own threshold, else the global one. */
export function thresholdFor(category, settings) {
  const own = settings.categories.find((c) => c.name.trim() === category)?.threshold;
  return typeof own === 'number' ? own : settings.thresholds.category;
}

function round(n) {
  return n === null || n === undefined ? null : Math.round(n * 1000) / 1000;
}

/**
 * @param {object} [known] answers decided without the API, e.g. { person: 'service' }
 * @returns {{category: string|null, tags: string[], review: boolean,
 *   reasons: string[], scores: object}}
 */
export function decide(answers, settings, known = {}) {
  const t = settings.thresholds;
  const tags = [];
  const reasons = [];
  let review = false;
  let category = null;

  const categoriesOff = settings.categorySort?.enabled === false;
  const cat = categoriesOff ? null : answers?.category;
  const rawChoice = typeof cat?.choice === 'string' ? cat.choice : null;
  const choice = matchCategory(rawChoice, settings);
  const catProbability = rawChoice === null ? null : choiceProbability(cat, choice);
  const catConfidence = typeof cat?.confidence === 'number' ? cat.confidence : null;
  if (categoriesOff) {
    reasons.push('Categories off');
  } else if (!rawChoice) {
    review = true;
    reasons.push('No category answer');
  } else if (choice === null) {
    // A label we didn't offer (e.g. text in the email steering the model): never act on it.
    review = true;
    reasons.push(`Unexpected category from the model: "${rawChoice.slice(0, 40)}"`);
  } else if (choice === OTHER_CATEGORY) {
    reasons.push('No category fits');
  } else if (catProbability === null || catProbability < thresholdFor(choice, settings)) {
    review = true;
    reasons.push(`Unsure of category (${choice} at ${round(catProbability)})`);
  } else {
    category = choice;
    tags.push(TAG_NAME_PREFIX + choice);
  }

  // Only the affirmative is tagged: a real person gets "Real person";
  // anything else gets no tag (known.person 'service' means "not a real person").
  const askedPerson = settings.questions.person && !known.person;
  const person = askedPerson ? readNoul(answers?.person) : null;
  if (known.person === 'person') tags.push(REAL_PERSON_TAG);
  else if (person !== null) {
    if (person >= t.realPerson) tags.push(REAL_PERSON_TAG);
    // Answers this close to the threshold are noted, so the log shows borderline calls.
    if (Math.abs(person - t.realPerson) < UNSURE_MARGIN) reasons.push(`Unsure if a real person (${round(person)})`);
  } else if (askedPerson) {
    reasons.push('Answer for Real person not understood');
  }

  const needsReply = settings.questions.needsReply ? readNoul(answers?.needs_reply) : null;
  if (needsReply !== null && needsReply >= t.needsReply) tags.push(NEEDS_REPLY_TAG);
  if (needsReply !== null && Math.abs(needsReply - t.needsReply) < UNSURE_MARGIN) {
    reasons.push(`Unsure if a reply is needed (${round(needsReply)})`);
  }
  if (needsReply === null && settings.questions.needsReply) reasons.push('Answer for Needs reply not understood');

  const toDo = settings.questions.toDo ? readNoul(answers?.to_do) : null;
  // A category set to "Never a To-do" suppresses the to-do; only an applied category counts.
  // The to-do is a decision only (it flags the message when asked to), not a tag.
  const noToDo = category !== null && settings.categories.find((c) => c.name.trim() === category)?.noToDo === true;
  let isToDo = false;
  if (toDo !== null && toDo >= t.toDo && noToDo) reasons.push(`No To-do for ${category} (your category setting)`);
  else if (toDo !== null && toDo >= t.toDo) isToDo = true;
  if (toDo !== null && !noToDo && Math.abs(toDo - t.toDo) < UNSURE_MARGIN) reasons.push(`Unsure if it's a to-do (${round(toDo)})`);
  if (toDo === null && settings.questions.toDo) reasons.push('Answer for To-do not understood');

  const junkScore = settings.questions.junk ? readNoul(answers?.junk) : null;
  const junk = junkScore !== null && junkScore >= t.junk;
  if (junkScore !== null && Math.abs(junkScore - t.junk) < UNSURE_MARGIN) reasons.push(`Unsure if it's junk (${round(junkScore)})`);
  if (junkScore === null && settings.questions.junk) reasons.push('Answer for Junk not understood');
  if (junk) {
    // Visible as a tag too: Thunderbird's Junk mark alone is easy to miss.
    tags.push(JUNK_TAG);
    // Junk asks for nothing: no reply tag or to-do (and so no flag) on spam or phishing.
    const i = tags.indexOf(NEEDS_REPLY_TAG);
    if (i >= 0) tags.splice(i, 1);
    isToDo = false;
  }

  // Second safeguard: only ever tags Preen knows about.
  const allowed = new Set([
    ...settings.categories.map((c) => TAG_NAME_PREFIX + c.name.trim()),
    REAL_PERSON_TAG, NEEDS_REPLY_TAG, JUNK_TAG,
  ]);

  return {
    category,
    tags: tags.filter((tag) => allowed.has(tag)),
    review,
    toDo: isToDo,
    junk,
    reasons,
    scores: {
      categoryChoice: rawChoice,
      categoryProbability: round(catProbability),
      categoryConfidence: round(catConfidence),
      person: round(person),
      needsReply: round(needsReply),
      toDo: round(toDo),
      junk: round(junkScore),
    },
  };
}
