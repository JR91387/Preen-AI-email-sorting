// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Small building blocks shared by Preen's pages: element helpers, file download,
// icons and info tips.

const SVG = 'http://www.w3.org/2000/svg';

export const $ = (id) => document.getElementById(id);

// The only properties el() sets, so a stray key (a markup property, an on… handler) can't slip in.
const EL_PROPS = new Set([
  'className', 'textContent', 'id', 'title', 'htmlFor', 'href', 'type', 'value', 'checked', 'disabled',
  'open', 'rows', 'placeholder', 'maxLength', 'min', 'max', 'step',
]);

/** Creates an element with properties (and a `dataset` object), then appends the children that aren't null. */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'dataset') Object.assign(node.dataset, v);
    else if (EL_PROPS.has(k)) node[k] = v;
    else throw new Error(`el(): property "${k}" is not allowed (add it to EL_PROPS if it is safe)`);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

/** Saves `text` as a file through the browser's download. */
export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** An icon from the page's SVG sprite (`<symbol id="i-…">`). */
export function icon(name, className = 'ico') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

// Save marks: one look for "this saved" and "this still needs Save" beside a control.
// 'saved' (a check) shows for a moment, for controls that save at once. 'pending' (the same
// dot as the Save button's) stays until the page's Save or Discard clears it.
const SAVED_MARK_MS = 2000;
const markTimers = new WeakMap();
const pendingMarks = new Set();

/**
 * @param {HTMLElement} node the mark's own element (a span with class save-mark)
 * @param {'saved'|'pending'|null} kind null clears it
 */
export function setSaveMark(node, kind) {
  clearTimeout(markTimers.get(node));
  pendingMarks.delete(node);
  node.className = kind ? `save-mark ${kind}` : 'save-mark';
  node.setAttribute('role', 'status');
  node.hidden = !kind;
  if (kind === 'saved') {
    node.replaceChildren(icon('check'), 'Saved');
    const timer = setTimeout(() => setSaveMark(node, null), SAVED_MARK_MS);
    timer.unref?.();
    markTimers.set(node, timer);
  } else if (kind === 'pending') {
    node.replaceChildren(el('span', { className: 'dot' }), 'Not saved yet');
    pendingMarks.add(node);
  } else {
    node.replaceChildren();
  }
}

/** Clears every "Not saved yet" mark (the page was saved or its changes discarded). */
export function clearPendingMarks() {
  for (const node of [...pendingMarks]) setSaveMark(node, null);
}

// Tips that are showing, so Esc and an outside click can close them all.
const openTips = new Set();
let tipCount = 0;

// Page-wide listeners are added with the first tip, not when this file loads.
let listening = false;
function listenForClosing() {
  if (listening) return;
  listening = true;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') for (const close of [...openTips]) close();
  });
  document.addEventListener('click', (event) => {
    // A click inside a tip (its button or its text) is handled by the tip itself.
    if (event.target?.closest?.('.tip')) return;
    for (const close of [...openTips]) close();
  });
}

/**
 * A small ⓘ button that explains a setting in a popover. The popover opens on
 * hover, keyboard focus or click; Esc or a click elsewhere closes it. The text
 * is tied to the button with aria-describedby while open, so screen readers announce it
 * on focus, and the button says what it is about.
 *
 * @param {string} text
 * @param {string} [subject] what the tip is about, for the button's name ("More about …")
 */
export function infoTip(text, subject = '') {
  listenForClosing();
  const id = `tip-${++tipCount}`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tip-btn';
  button.setAttribute('aria-label', subject ? `More about ${subject}` : 'More information');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.append(icon('info'));

  const pop = document.createElement('span');
  pop.className = 'tip-pop';
  pop.id = id;
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  pop.textContent = text;

  const wrap = document.createElement('span');
  wrap.className = 'tip';
  wrap.append(button, pop);

  // "Pinned" means opened by a click or key press: hover and focus alone close again.
  let pinned = false;
  let hovered = false;
  const show = () => {
    // Described only while visible: a hidden description isn't read by every screen reader.
    button.setAttribute('aria-describedby', id);
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openTips.add(close);
    // Keep the popover on the page when the button is near the right edge.
    const box = pop.getBoundingClientRect?.();
    pop.classList.toggle('end', Boolean(box && box.right > (globalThis.innerWidth ?? Infinity)));
  };
  function close() {
    button.removeAttribute('aria-describedby');
    pinned = false;
    hovered = false;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    openTips.delete(close);
  }
  const settle = () => {
    if (!pinned && !hovered && document.activeElement !== button) close();
  };

  button.addEventListener('click', () => {
    if (pinned) close();
    else {
      pinned = true;
      show();
    }
  });
  button.addEventListener('focus', show);
  button.addEventListener('blur', () => { if (!pinned) settle(); });
  wrap.addEventListener('mouseenter', () => { hovered = true; show(); });
  wrap.addEventListener('mouseleave', () => { hovered = false; settle(); });
  button.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  return wrap;
}

/** Shows "N / limit" (trimmed length of `input`) in `counter`, marked `over` past the limit. */
export function updateCounter(input, counter, limit) {
  const length = input.value.trim().length;
  counter.textContent = `${length} / ${limit}`;
  counter.classList.toggle('over', length > limit);
}

/** Opens `element`'s section and every collapsible row around it, e.g. to show an error. */
export function reveal(element) {
  for (let node = element; node; node = node.parentElement) {
    if (node.tagName === 'DETAILS') node.open = true;
  }
}

/**
 * Preen's own dialog, in place of the browser's built-in confirm and alert boxes. Resolves true for the
 * confirm button, false for cancel or Esc. Without `cancelLabel` it is a notice with one button.
 * The safe choice (cancel, or the only button) has the focus.
 */
export function askDialog({ title, message = '', confirmLabel = 'OK', cancelLabel = null, danger = false }) {
  return new Promise((resolve) => {
    const finish = (answer) => {
      backdrop.remove();
      previous?.focus?.();
      resolve(answer);
    };
    const previous = document.activeElement;
    const yes = el('button', { type: 'button', className: danger ? 'btn danger' : 'btn primary', id: 'dialogYes', textContent: confirmLabel });
    const no = cancelLabel ? el('button', { type: 'button', className: 'btn', id: 'dialogNo', textContent: cancelLabel }) : null;
    yes.addEventListener('click', () => finish(true));
    no?.addEventListener('click', () => finish(false));
    const box = el('div', { className: 'dialog' },
      el('strong', { id: 'dialogTitle', textContent: title }),
      el('p', { className: 'dialog-text', id: 'dialogText', textContent: message }),
      el('div', { className: 'dialog-buttons' }, ...[no, yes]));
    box.setAttribute('role', no ? 'dialog' : 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'dialogTitle');
    box.setAttribute('aria-describedby', 'dialogText');
    box.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(false); });
    const backdrop = el('div', { className: 'dialog-backdrop', id: 'preenDialog' }, box);
    document.body.append(backdrop);
    (no ?? yes).focus();
  });
}

/** A one-button notice, in place of the browser's alert box. */
export const notify = (title, message) => askDialog({ title, message });
