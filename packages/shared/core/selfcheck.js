// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The startup self-check: problems a user would otherwise only
// notice when something silently stops working. Pure, so it can be tested;
// the background script gathers the facts and reports the result.

/**
 * @param {{menusOk: boolean, settingsErrors: string[]}} facts
 * @returns {string[]} one plain sentence per problem; empty when all is well
 */
export function selfCheckProblems({ menusOk, settingsErrors }) {
  const problems = [];
  if (!menusOk) problems.push('Preen’s right-click menus could not be added; restart Thunderbird.');
  if (settingsErrors.length) {
    problems.push(`Settings need attention: ${settingsErrors[0]}${settingsErrors.length > 1 ? ` (+${settingsErrors.length - 1} more)` : ''} Open Preen settings to fix.`);
  }
  return problems;
}

/**
 * A notice when the provider starts answering with a different model: the
 * certainty levels were tuned on the previous one.
 * @returns {string|null}
 */
export function modelChangeNotice(previous, current) {
  if (!previous || !current || previous === current) return null;
  return `Your provider now answers with ${current} (was ${previous}). Preen's certainty levels were tuned on the earlier `
    + 'model; check the results for a few days and adjust Settings if tags look off.';
}
