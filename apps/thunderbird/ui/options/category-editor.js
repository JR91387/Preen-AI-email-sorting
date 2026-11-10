// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Category editor: one collapsible row per category with name, "is", "is not",
// certainty required (Low / Medium / High / Custom) and actions; plus
// one-click suggested categories. A row's header shows the name, the first
// line of the description and the certainty level, so closed rows still say
// what they are.

import {
  DEFAULT_SETTINGS, MAX_CATEGORIES, MAX_NAME_LENGTH, DESCRIPTION_LIMIT, SUGGESTED_CATEGORIES,
} from '../../core/settings-schema.js';
import { categoryCriterion } from '../../core/questions.js';
import { createLevelPicker } from '../shared/level-picker.js';
import { LEVEL_LABELS, levelOf } from '../../core/levels.js';
import { el, icon, infoTip, updateCounter, askDialog } from '../shared/ui.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

function field(labelText, hint, input, ...rest) {
  input.id = nextId('cat');
  return el('div', { className: 'field' },
    el('label', { htmlFor: input.id }, labelText, hint ? el('span', { className: 'opt' }, ` ${hint}`) : null),
    input,
    ...rest);
}

/**
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {() => void} [options.onChange] called whenever the categories change
 * @param {string} [options.noToDoTip] info tip text for the "Never a To-do" switch
 * @param {() => number} [options.defaultThreshold] the global certainty, used by
 *   categories without their own
 * @returns {{set(categories: object[]): void, get(): object[], invalidRows(): HTMLElement[]}}
 */
export function createCategoryEditor(container, { onChange = () => {}, defaultThreshold = () => 0.75, noToDoTip = '' } = {}) {
  let categories = [];
  // Which rows are open, in the same order as `categories` (kept across re-renders).
  let open = [];
  const limit = DESCRIPTION_LIMIT;

  const list = el('div', { className: 'cats' });
  const addButton = el('button', { type: 'button', className: 'btn' }, icon('plus'), 'Add category');
  const resetButton = el('button', { type: 'button', className: 'btn ghost', textContent: 'Reset to defaults' });
  const count = el('span', { className: 'count-txt' });
  const suggestions = el('div', { className: 'suggest' });
  container.replaceChildren(list, el('div', { className: 'cat-foot' }, addButton, resetButton, count), suggestions);

  function sync() {
    // Pull current values out of the inputs before re-rendering.
    const cards = [...list.querySelectorAll('.cat-card')];
    open = cards.map((card) => Boolean(card.open));
    categories = cards.map((card) => {
      const get = (name) => card.querySelector(`[data-field="${name}"]`);
      const category = {
        name: get('name').value.trim(),
        description: get('description').value,
      };
      if (get('excludes').value.trim()) category.excludes = get('excludes').value;
      // Only stored once the user sets it for this category, so categories
      // that never did keep following the default certainty.
      const threshold = Number(get('threshold').value);
      if (get('threshold').dataset.own && get('threshold').value !== '' && Number.isFinite(threshold)) {
        category.threshold = threshold;
      }
      const actions = {};
      if (get('flag').checked) actions.flag = true;
      if (get('markUnread').checked) actions.markUnread = true;
      if (Object.keys(actions).length) category.actions = actions;
      if (get('noToDo').checked) category.noToDo = true;
      return category;
    });
  }

  /** The row header (name, description, certainty) and the "Jev sees" line. */
  function preview(card) {
    const get = (name) => card.querySelector(`[data-field="${name}"]`);
    const description = get('description').value;
    card.querySelector('.name').textContent = get('name').value.trim();
    card.querySelector('.desc').textContent = description.trim();
    const threshold = get('threshold');
    const level = levelOf('certainty', { threshold: threshold.value.trim() === '' ? NaN : Number(threshold.value) });
    card.querySelector('.cat-level').textContent = `Certainty: ${LEVEL_LABELS[level]}${threshold.dataset.own ? '' : ' (default)'}`;
    const out = card.querySelector('.jev');
    out.replaceChildren(...(description.trim()
      ? [el('b', {}, 'Jev sees: '), categoryCriterion({ description, excludes: get('excludes').value })]
      : []));
  }

  function card(category, index) {
    const name = el('input', { type: 'text', value: category.name ?? '', maxLength: MAX_NAME_LENGTH, dataset: { field: 'name' } });
    // No maxLength: existing text longer than a lowered limit stays visible
    // (marked in red) until the user shortens it; saving explains the problem.
    const description = el('textarea', { rows: 2, value: category.description ?? '', dataset: { field: 'description' } });
    const excludes = el('textarea', { rows: 2, value: category.excludes ?? '', dataset: { field: 'excludes' } });
    const nameCounter = el('span', { className: 'count' });
    const descriptionCounter = el('span', { className: 'count' });
    const excludesCounter = el('span', { className: 'count' });
    description.placeholder = 'e.g. Receipts, invoices, order and shipping confirmations';
    excludes.placeholder = 'e.g. Marketing or promotional emails from shops';

    const flag = el('input', { type: 'checkbox', checked: Boolean(category.actions?.flag), dataset: { field: 'flag' } });
    // No "mark as read": Preen never marks mail read, because read means the user read it.
    const markUnread = el('input', { type: 'checkbox', checked: Boolean(category.actions?.markUnread), dataset: { field: 'markUnread' } });

    const noToDo = el('input', { type: 'checkbox', checked: category.noToDo === true, dataset: { field: 'noToDo' } });

    const threshold = el('input', {
      type: 'number', min: 0, max: 1, step: 0.05, value: category.threshold ?? defaultThreshold(),
      dataset: { field: 'threshold', own: category.threshold !== undefined ? '1' : '' },
    });
    threshold.setAttribute('aria-label', 'Certainty required (0 to 1)');
    const setOwn = () => { threshold.dataset.own = '1'; };
    threshold.addEventListener('input', () => {
      // Clearing the field means "use the default certainty" again.
      threshold.dataset.own = threshold.value.trim() === '' ? '' : '1';
    });
    const thresholdLabel = el('label', {}, 'Certainty required (0–1)');
    thresholdLabel.htmlFor = threshold.id = nextId('cat');
    const certainty = createLevelPicker({
      group: 'certainty',
      details: el('div', {}, el('div', { className: 'field' }, thresholdLabel, threshold)),
      read: () => ({ threshold: threshold.value.trim() === '' ? NaN : Number(threshold.value) }),
      write: (values) => { threshold.value = values.threshold; },
      onChange: () => { setOwn(); preview(node); onChange(); },
      showValue: false,
    });

    const tool = (name, title, disabled) => {
      const b = el('button', { type: 'button', className: 'btn ghost icon', title, disabled }, icon(name));
      b.setAttribute('aria-label', title);
      return b;
    };
    const up = tool('up', 'Move up', index === 0);
    const down = tool('down', 'Move down', index === categories.length - 1);
    const remove = tool('trash', 'Remove', categories.length <= 1);
    const checkbox = (input, iconName, text) => el('label', { className: 'check' }, input, icon(iconName), text);

    const node = el('details', { className: 'cat cat-card', open: Boolean(open[index]) },
      el('summary', {},
        icon('caret', 'ico caret'),
        el('span', { className: 'sumtext' }, el('span', { className: 'name' }), el('span', { className: 'desc' })),
        el('span', { className: 'pill cat-level' }),
        el('span', { className: 'tools' }, up, down, remove)),
      el('div', { className: 'body' },
        field('Name', '', name, el('div', { className: 'inline count-row' },
          el('p', { className: 'help' }, 'The name is also the tag, e.g. Preen/Receipts.'), nameCounter)),
        el('div', { className: 'grid g2' },
          field('Is', '— what belongs here', description, descriptionCounter),
          field('Is not', '— optional: similar mail that belongs elsewhere', excludes, excludesCounter)),
        el('div', { className: 'grid g2' },
          el('div', { className: 'field' }, certainty.element,
            el('p', { className: 'help' }, 'Medium is balanced. High: fewer, safer tags. Low: more tags, more mistakes.')),
          el('div', { className: 'field' }, el('span', { className: 'label' }, 'When tagged'),
            el('div', { className: 'when-tagged' }, checkbox(flag, 'flag', 'Flag'), checkbox(markUnread, 'dot', 'Mark as unread')))),
        el('div', { className: 'when-tagged' },
          el('label', { className: 'check' }, noToDo, 'Never a To-do'),
          noToDoTip ? infoTip(noToDoTip, 'Never a To-do') : null),
        el('p', { className: 'jev' })));

    updateCounter(name, nameCounter, MAX_NAME_LENGTH);
    for (const [input, counter] of [[description, descriptionCounter], [excludes, excludesCounter]]) {
      updateCounter(input, counter, limit);
      input.addEventListener('input', () => {
        updateCounter(input, counter, limit);
        preview(node);
        onChange();
      });
    }
    name.addEventListener('input', () => {
      updateCounter(name, nameCounter, MAX_NAME_LENGTH);
      preview(node);
      onChange();
    });
    threshold.addEventListener('input', () => preview(node));
    flag.addEventListener('change', onChange);
    markUnread.addEventListener('change', onChange);
    noToDo.addEventListener('change', onChange);
    // Buttons in the row header: they act without opening or closing the row.
    const move = (delta) => {
      sync();
      const [item] = categories.splice(index, 1);
      categories.splice(index + delta, 0, item);
      const [wasOpen] = open.splice(index, 1);
      open.splice(index + delta, 0, wasOpen);
      render();
    };
    up.addEventListener('click', (event) => { event.preventDefault(); move(-1); });
    down.addEventListener('click', (event) => { event.preventDefault(); move(1); });
    remove.addEventListener('click', (event) => {
      event.preventDefault();
      sync();
      categories.splice(index, 1);
      open.splice(index, 1);
      render();
    });
    preview(node);
    return node;
  }

  function renderSuggestions() {
    const have = new Set(categories.map((c) => c.name.trim().toLowerCase()));
    const offer = SUGGESTED_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
    const full = categories.length >= MAX_CATEGORIES;
    suggestions.hidden = offer.length === 0;
    suggestions.replaceChildren(...(offer.length ? [
      el('span', {}, 'Suggested:'),
      ...offer.map((c) => {
        const b = el('button', { type: 'button', className: 'btn small', textContent: `+ ${c.name}`, disabled: full });
        b.addEventListener('click', () => {
          sync();
          categories.push(structuredClone(c));
          open.push(false);
          render();
        });
        return b;
      }),
    ] : []));
  }

  function render() {
    list.replaceChildren(...categories.map(card));
    addButton.disabled = categories.length >= MAX_CATEGORIES;
    count.textContent = `${categories.length} of ${MAX_CATEGORIES}`;
    renderSuggestions();
    onChange();
  }

  addButton.addEventListener('click', () => {
    sync();
    categories.push({ name: '', description: '' });
    open.push(true);
    render();
    list.lastElementChild?.querySelector('[data-field="name"]')?.focus();
  });
  resetButton.addEventListener('click', async () => {
    const yes = await askDialog({
      title: 'Replace your categories with the defaults?',
      message: 'Your own categories and their descriptions are replaced.',
      confirmLabel: 'Use the defaults',
      cancelLabel: 'Keep mine',
      danger: true,
    });
    if (!yes) return;
    categories = structuredClone(DEFAULT_SETTINGS.categories);
    open = [];
    render();
  });

  return {
    set(value) {
      // Re-rendering the same list (e.g. after the default certainty changed) keeps rows open.
      const keepOpen = value.length === categories.length ? [...list.querySelectorAll('.cat-card')].map((c) => c.open) : [];
      categories = structuredClone(value);
      open = keepOpen;
      render();
    },
    /** Rows with an empty name or description, or text over the limit. */
    invalidRows() {
      return [...list.querySelectorAll('.cat-card')].filter((card) => {
        const get = (name) => card.querySelector(`[data-field="${name}"]`).value.trim();
        return !get('name') || !get('description')
          || get('description').length > limit || get('excludes').length > limit;
      });
    },
    get() {
      sync();
      return structuredClone(categories);
    },
  };
}
