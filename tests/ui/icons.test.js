// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Icons are built as SVG nodes (never from markup strings); each one serializes to the markup
// the sprite references expect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUpPage } from './page-env.js';

setUpPage('popup/popup');
const { icon } = await import('../../apps/thunderbird/ui/shared/ui.js');

const markup = (n) => {
  const attrs = Object.entries(n.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
  const tag = n.tagName.toLowerCase();
  return `<${tag}${attrs}>${n.children.map(markup).join('')}</${tag}>`;
};

test('the feather and pen icons keep their classes and sprite references', () => {
  assert.equal(markup(icon('feather')), '<svg class="ico" aria-hidden="true"><use href="#i-feather"></use></svg>');
  assert.equal(markup(icon('feather', 'ico feather')), '<svg class="ico feather" aria-hidden="true"><use href="#i-feather"></use></svg>');
  assert.equal(markup(icon('pen')), '<svg class="ico" aria-hidden="true"><use href="#i-pen"></use></svg>');
});
