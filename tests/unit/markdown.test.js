// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The privacy policy ships as PRIVACY.md and is shown by a page that builds elements from
// these blocks: every heading must survive, and no Markdown syntax may leak into the text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseMarkdown, parseInline, inlineText } from '../../packages/shared/core/markdown.js';
import { PRIVACY_PAGE } from '../../packages/shared/core/consent.js';

const policy = readFileSync(new URL('../../PRIVACY.md', import.meta.url), 'utf8');

function* walk(blocks) {
  for (const b of blocks) {
    yield b;
    if (b.type === 'list') for (const item of b.items) { yield { type: 'item', inline: item.inline }; yield* walk(item.children); }
  }
}

test('inline: bold, code and links; non-web links stay text', () => {
  assert.deepEqual(parseInline('a **b** `c<d>` [t](https://x.test/p) [u](javascript:alert(1))'), [
    { type: 'text', text: 'a ' },
    { type: 'strong', inline: [{ type: 'text', text: 'b' }] },
    { type: 'text', text: ' ' },
    { type: 'code', text: 'c<d>' },
    { type: 'text', text: ' ' },
    { type: 'link', text: 't', href: 'https://x.test/p' },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'u' },
    { type: 'text', text: ')' },
  ]);
});

test('blocks: headings, joined paragraph lines, nested bullets', () => {
  const blocks = parseMarkdown('# T\n\nline one\nline two\n\n## H\n- a\n  - b\n  - c\n- d\n\nafter');
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'heading', 'list', 'paragraph']);
  assert.equal(inlineText(blocks[1].inline), 'line one line two');
  const list = blocks[3];
  assert.deepEqual(list.items.map((i) => inlineText(i.inline)), ['a', 'd']);
  assert.deepEqual(list.items[0].children[0].items.map((i) => inlineText(i.inline)), ['b', 'c']);
});

test('the real PRIVACY.md: every ## heading is a heading block and no Markdown syntax is left in the text', () => {
  const expected = policy.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).replaceAll('**', '').trim());
  const blocks = parseMarkdown(policy);
  const headings = blocks.filter((b) => b.type === 'heading' && b.level === 2).map((b) => inlineText(b.inline));
  assert.ok(expected.length > 5);
  assert.deepEqual(headings, expected);
  for (const b of walk(blocks)) {
    if (!b.inline) continue;
    const text = inlineText(b.inline);
    assert.doesNotMatch(text, /\*\*|\]\(/, text.slice(0, 60));
  }
});

test('the privacy page is packaged: page file exists and the policy is linked into the app', () => {
  assert.equal(PRIVACY_PAGE, 'ui/privacy/privacy.html');
  assert.ok(existsSync(new URL(`../../apps/thunderbird/${PRIVACY_PAGE}`, import.meta.url)));
  assert.equal(readFileSync(new URL('../../apps/thunderbird/PRIVACY.md', import.meta.url), 'utf8'), policy);
});
