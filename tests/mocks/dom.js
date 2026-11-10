// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// A small stand-in for a browser page, enough to load Preen's page scripts in
// Node and catch errors while they start up. It builds the real HTML into a
// tree and, like a browser, getElementById only finds elements that are
// attached to the page (detached elements are invisible to it: finding F13).

import { readFileSync } from 'node:fs';

const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr']);

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { for (const x of c) this.set.add(x); }
  remove(...c) { for (const x of c) this.set.delete(x); }
  toggle(c, force) { const on = force ?? !this.set.has(c); if (on) this.set.add(c); else this.set.delete(c); return on; }
  contains(c) { return this.set.has(c); }
}

function nodeList(items) {
  const list = { length: items.length, item: (i) => items[i] ?? null, forEach: (f, t) => items.forEach(f, t), [Symbol.iterator]: () => items[Symbol.iterator]() };
  items.forEach((n, i) => { list[i] = n; });
  return list;
}

export class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.classList = new ClassList();
    this.dataset = {};
    // Like a browser's CSSStyleDeclaration: custom properties go through setProperty.
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.listeners = {};
    this._value = '';
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
  }

  get value() { return this._value; }
  set value(v) { this._value = String(v ?? ''); }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v ?? ''); }
  get className() { return [...this.classList.set].join(' '); }
  set className(v) { this.classList = new ClassList(); this.classList.add(...String(v).split(/\s+/).filter(Boolean)); }
  get parentElement() { return this.parentNode; }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  get nextElementSibling() {
    const s = this.parentNode?.children;
    return s ? s[s.indexOf(this) + 1] ?? null : null;
  }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === globalThis.document?.documentElement;
  }

  append(...nodes) {
    for (const n of nodes) {
      if (n instanceof Element) {
        n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1);
        n.parentNode = this;
        this.children.push(n);
      } else if (n !== null && n !== undefined) {
        this._text += String(n);
      }
    }
  }
  prepend(node) {
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    node.parentNode = this;
    this.children.unshift(node);
  }
  replaceChildren(...nodes) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }
  replaceWith(node) {
    const parent = this.parentNode;
    if (!parent) return;
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    parent.children[parent.children.indexOf(this)] = node;
    node.parentNode = parent;
    this.parentNode = null;
  }
  after(node) {
    const parent = this.parentNode;
    if (!parent) return;
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    parent.children.splice(parent.children.indexOf(this) + 1, 0, node);
    node.parentNode = parent;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  // Like the browser: listeners on this node, then up the tree when the event bubbles.
  dispatchEvent(event) {
    for (let n = this; n; n = event.bubbles ? n.parentNode : null) {
      for (const fn of n.listeners?.[event.type] ?? []) fn({ type: event.type, target: this, currentTarget: n, preventDefault() {} });
    }
    return true;
  }
  focus() {}
  click() {}

  *descendants() {
    for (const c of this.children) {
      yield c;
      yield* c.descendants();
    }
  }
  matchesOne(sel) {
    const m = sel.match(/^([a-z0-9]*)((?:#[\w-]+)?)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)(:checked)?$/i);
    if (!m) throw new Error(`Selector not supported by the test DOM: ${sel}`);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && this.id !== m[2].slice(1)) return false;
    for (const c of m[3].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    for (const a of m[4].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      const name = a[1];
      const actual = name.startsWith('data-')
        ? this.dataset[name.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())]
        : this.attributes[name] ?? this[name];
      if (actual === undefined || actual === null || (a[2] !== undefined && String(actual) !== a[2])) return false;
    }
    if (m[5] && !this.checked) return false;
    return true;
  }
  matches(selector) {
    return selector.split(',').map((s) => s.trim()).some((part) => {
      const steps = part.split(/\s+/);
      if (!this.matchesOne(steps.at(-1))) return false;
      let node = this.parentNode;
      for (let i = steps.length - 2; i >= 0; i--) {
        while (node && !node.matchesOne(steps[i])) node = node.parentNode;
        if (!node) return false;
        node = node.parentNode;
      }
      return true;
    });
  }
  closest(selector) {
    for (let n = this; n; n = n.parentNode) if (n.matchesOne && n.matches(selector)) return n;
    return null;
  }
  // Like a browser NodeList: indexable, iterable, forEach — but no filter/map, so array-only calls fail in tests too.
  querySelectorAll(selector) { return nodeList([...this.descendants()].filter((n) => n.matches(selector))); }
  querySelector(selector) { return [...this.descendants()].find((n) => n.matches(selector)) ?? null; }
}

class OptionElement extends Element {
  constructor(text = '', value) {
    super('option');
    this._text = String(text);
    this.value = value ?? text;
  }
}

/** Builds the page's HTML into an element tree (enough for Preen's own pages). */
function parse(html, root) {
  const stack = [root];
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
  for (const m of body.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi)) {
    const top = stack.at(-1);
    if (m[4] !== undefined) {
      if (m[4].trim()) top._text += m[4].trim();
      continue;
    }
    const [, closing, tag, attrs] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const el = tag.toLowerCase() === 'option' ? new OptionElement() : new Element(tag);
    for (const a of attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
      const [, name, value = ''] = a;
      el.attributes[name] = value;
      if (name === 'id') el.id = value;
      else if (name === 'class') el.className = value;
      else if (name.startsWith('data-')) el.dataset[name.slice(5).replace(/-(\w)/g, (_, x) => x.toUpperCase())] = value; // camelCase, as browsers do
      else if (name === 'value') el.value = value;
      else if (name === 'hidden') el.hidden = true;
      else if (name === 'checked') el.checked = true;
      else if (name === 'open') el.open = true;
      else if (name === 'type') el.type = value;
    }
    top.append(el);
    if (!VOID.has(tag.toLowerCase()) && !/\/\s*$/.test(attrs)) stack.push(el);
  }
}

/**
 * Sets up `document`, `window` and friends for a page file.
 * @returns {{document: object, errors: Error[]}} errors: uncaught errors reported to window
 */
export function loadPage(htmlPath) {
  const documentElement = new Element('html');
  parse(readFileSync(htmlPath, 'utf8'), documentElement);
  const find = (pred) => {
    for (const n of documentElement.descendants()) if (pred(n)) return n;
    return null;
  };
  const document = {
    documentElement,
    get body() { return find((n) => n.tagName === 'BODY'); },
    get head() { return find((n) => n.tagName === 'HEAD'); },
    // Like a browser: only elements attached to the page are found.
    getElementById: (id) => find((n) => n.id === id),
    querySelector: (s) => documentElement.querySelector(s),
    querySelectorAll: (s) => documentElement.querySelectorAll(s),
    createElement: (tag) => (tag.toLowerCase() === 'option' ? new OptionElement() : new Element(tag)),
    createElementNS: (ns, tag) => new Element(tag),
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    },
    /** Test helper: fire an event at the document's listeners. */
    dispatch(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    },
    readyState: 'loading',
  };
  const listeners = {};
  const errors = [];
  globalThis.document = document;
  globalThis.Option = OptionElement;
  globalThis.CSS = { escape: (s) => String(s) };
  globalThis.window = {
    listeners,
    addEventListener(type, fn) {
      (listeners[type] ??= []).push(fn);
    },
    /** Test helper: fire an event at the page's window listeners. */
    dispatch(type, event) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
    close() {},
  };
  globalThis.confirm = () => true;
  globalThis.alert = () => {};
  return { document, errors };
}
