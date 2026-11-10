// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Low / Medium / High / Custom buttons for a setting that's really a level.
// The caption names a quantity; High always means more of it. Choosing a
// level fills in the detailed values; Custom shows them; editing a detail
// switches to Custom (or back to a level if the values match one). Next to
// the buttons, a line says what the current values are, e.g. "0.8 on a 0–1 scale".

import { LEVELS, LEVEL_LABELS, LEVEL_GROUPS, levelOf, applyLevel, valueText } from '../../core/levels.js';

let uid = 0;

/**
 * @param {object} options
 * @param {string} options.group a LEVEL_GROUPS key
 * @param {string} [options.caption] defaults to the group's caption; '' for none
 *   (when the page already labels it)
 * @param {boolean} [options.showValue] show the current values next to the buttons
 * @param {HTMLElement} options.details the detailed fields, shown for Custom
 * @param {() => object} options.read current values, shaped like the settings
 * @param {(values: object) => void} options.write puts preset values into the fields
 * @param {() => void} [options.onChange] after a level is chosen
 * @param {(level: string) => Node[]} [options.icon] SVG nodes shown above a level's name
 * @returns {{element: HTMLElement, refresh: () => void}}
 */
export function createLevelPicker({ group, caption, details, read, write, onChange = () => {}, showValue = true, icon }) {
  const g = LEVEL_GROUPS[group];
  const id = `level-${group}-${++uid}`;
  let showCustom = false;

  const label = document.createElement('span');
  label.className = 'level-caption label';
  label.id = `${id}-caption`;
  label.textContent = caption ?? g.caption;
  label.hidden = label.textContent === '';

  const buttons = document.createElement('div');
  buttons.className = 'level-buttons seg';
  // Toggle buttons in a group (not radios): arrowing past a level must not
  // apply it, or it would overwrite Custom values.
  buttons.setAttribute('role', 'group');
  if (label.hidden) buttons.setAttribute('aria-label', g.caption);
  else buttons.setAttribute('aria-labelledby', label.id);

  const value = document.createElement('span');
  value.className = 'val';
  value.hidden = !showValue;

  const preset = document.createElement('div');
  preset.className = 'preset';
  preset.append(buttons, value);
  details.classList.add('custom-fields');

  const byLevel = {};
  for (const level of [...LEVELS, 'custom']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = LEVEL_LABELS[level];
    if (icon) {
      buttons.classList.add('with-icons');
      const pic = document.createElement('span');
      pic.className = 'lv-ico';
      pic.setAttribute('aria-hidden', 'true');
      pic.append(...icon(level));
      b.prepend(pic);
    }
    if (g.summary[level]) b.title = g.summary[level];
    b.addEventListener('click', () => {
      if (level === 'custom') {
        showCustom = true;
      } else {
        showCustom = false;
        write(applyLevel(group, level, read()));
      }
      refresh();
      onChange();
      if (level === 'custom') details.querySelector('input, select')?.focus();
    });
    byLevel[level] = b;
    buttons.append(b);
  }

  // Arrow keys move focus between the buttons (Tab works too); Enter or Space chooses.
  buttons.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const all = Object.values(byLevel);
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    all[(i + (event.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
  });

  function refresh() {
    const level = levelOf(group, read());
    const shown = showCustom || level === 'custom' ? 'custom' : level;
    for (const [l, b] of Object.entries(byLevel)) {
      const active = l === shown;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    }
    // The values are in plain view under Custom, so the line is only shown for a level.
    value.hidden = !showValue || shown === 'custom';
    value.replaceChildren(...(shown === 'custom' ? [] : valueText(group, read()).map((part) => {
      if (!Array.isArray(part)) return part;
      const strong = document.createElement('strong');
      strong.textContent = part[0];
      return strong;
    })));
    preset.classList.toggle('is-custom', shown === 'custom');
    details.hidden = shown !== 'custom';
  }

  // Editing a detail: the level follows the values.
  details.addEventListener('input', () => {
    showCustom = levelOf(group, read()) === 'custom';
    refresh();
  });

  const element = document.createElement('div');
  element.className = 'level-picker';
  element.append(label, preset, details);
  refresh();
  return { element, refresh };
}
