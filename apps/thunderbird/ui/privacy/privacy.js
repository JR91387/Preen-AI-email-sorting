// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Shows the privacy policy that ships inside the add-on (PRIVACY.md), so it is readable
// offline and always matches the installed version.

import { parseMarkdown } from '../../core/markdown.js';
import { $, el } from '../shared/ui.js';

function inlineNodes(parts) {
  return parts.map((p) => {
    if (p.type === 'strong') return el('strong', {}, ...inlineNodes(p.inline));
    if (p.type === 'code') return el('code', {}, p.text);
    if (p.type === 'link') {
      if (!/^(https?:|mailto:)/.test(p.href)) return p.text; // only web and mail links become clickable
      const a = el('a', { href: p.href }, p.text);
      a.target = '_blank';
      a.rel = 'noopener';
      return a;
    }
    return p.text;
  });
}

function blockNode(block) {
  if (block.type === 'heading') return el(`h${block.level}`, {}, ...inlineNodes(block.inline));
  if (block.type === 'paragraph') return el('p', {}, ...inlineNodes(block.inline));
  return el('ul', {}, ...block.items.map((item) => el('li', {}, ...inlineNodes(item.inline), ...item.children.map(blockNode))));
}

try {
  // A path relative to this file: the page needs no extension API just to read its own policy.
  const response = await fetch(new URL('../../PRIVACY.md', import.meta.url));
  if (!response.ok) throw new Error(`PRIVACY.md: HTTP ${response.status}`);
  $('policy').replaceChildren(...parseMarkdown(await response.text()).map(blockNode));
} catch (error) {
  console.error('Preen privacy page', error);
  $('policy').textContent = 'The privacy policy could not be loaded. Reinstalling Preen restores it.';
}
