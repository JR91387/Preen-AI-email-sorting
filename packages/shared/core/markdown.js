// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// The small subset of Markdown the privacy policy uses, parsed into plain blocks.
// A page turns the blocks into elements; nothing here touches a browser, and no
// markup is ever produced as a string.
//
// Block:  { type: 'heading', level, inline } | { type: 'paragraph', inline }
//         | { type: 'list', items: [{ inline, children: Block[] }] }
// Inline: { type: 'text', text } | { type: 'code', text }
//         | { type: 'strong', inline } | { type: 'link', text, href }

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const HEADING = /^(#{1,3}) +(.*\S)\s*$/;
const BULLET = /^( *)[-*] +(.*\S)\s*$/;

/** Only web links become links; anything else (javascript:, relative paths) stays plain text. */
const isWebUrl = (href) => /^https?:\/\//i.test(href);

export function parseInline(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'strong', inline: parseInline(m[1]) });
    else if (m[2] !== undefined) out.push({ type: 'code', text: m[2] });
    else if (isWebUrl(m[4])) out.push({ type: 'link', text: m[3], href: m[4] });
    else out.push({ type: 'text', text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Plain text of inline parts, for tests and labels. */
export function inlineText(inline) {
  return inline.map((p) => (p.type === 'strong' ? inlineText(p.inline) : p.text)).join('');
}

/** @returns {object[]} the document's blocks, in order */
export function parseMarkdown(source) {
  const blocks = [];
  let paragraph = [];
  let stack = []; // open lists, innermost last: { indent, list }

  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };

  for (const line of source.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (!heading && !bullet && line.trim()) {
      stack = [];
      paragraph.push(line.trim());
      continue;
    }
    endParagraph();
    if (heading) {
      stack = [];
      blocks.push({ type: 'heading', level: heading[1].length, inline: parseInline(heading[2]) });
    } else if (bullet) {
      const indent = bullet[1].length;
      while (stack.length && indent < stack.at(-1).indent) stack.pop();
      if (!stack.length || indent > stack.at(-1).indent) {
        const list = { type: 'list', items: [] };
        const parent = stack.at(-1)?.list.items.at(-1);
        (parent ? parent.children : blocks).push(list);
        stack.push({ indent, list });
      }
      stack.at(-1).list.items.push({ inline: parseInline(bullet[2]), children: [] });
    } else {
      stack = []; // a blank line ends the list
    }
  }
  endParagraph();
  return blocks;
}
