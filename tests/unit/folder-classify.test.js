// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Right-click a folder: every message in it (paged), optionally its
// subfolders at every depth, with special subfolders skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderMessageIds } from '../../apps/thunderbird/mail/folders.js';

function fakeMessenger(tree, messagesByFolder) {
  const pages = new Map();
  let next = 1;
  const page = (ids) => {
    // Two messages per page, so paging is exercised.
    const chunks = [];
    for (let i = 0; i < ids.length; i += 2) chunks.push(ids.slice(i, i + 2).map((id) => ({ id })));
    const listIds = chunks.map(() => `list-${next++}`);
    chunks.forEach((c, i) => pages.set(listIds[i], { id: i + 1 < chunks.length ? listIds[i + 1] : null, messages: chunks[i + 1] ?? [] }));
    return { id: chunks.length > 1 ? listIds[0] : null, messages: chunks[0] ?? [] };
  };
  return {
    folders: { async getSubFolders(id, deep) { assert.equal(deep, true); return tree[id] ?? []; } },
    messages: {
      async query({ folderId }) { return page(messagesByFolder[folderId] ?? []); },
      async abortList() {},
      async continueList(listId) { return pages.get(listId); },
    },
  };
}

const inbox = { id: 'f1', name: 'Inbox', specialUse: ['inbox'] };
const tree = {
  f1: [
    { id: 'f2', name: 'Projects', subFolders: [{ id: 'f3', name: 'Old', subFolders: [] }] },
    { id: 'f4', name: 'Trash', specialUse: ['trash'], subFolders: [] },
  ],
};
const msgs = { f1: [1, 2, 3, 4, 5], f2: [6], f3: [7, 8], f4: [9] };

test('folder only: every message in the clicked folder, across pages', async () => {
  globalThis.messenger = fakeMessenger(tree, msgs);
  const r = await folderMessageIds(inbox);
  assert.deepEqual(r.ids, [1, 2, 3, 4, 5]);
  assert.equal(r.folders, 1);
});

test('with subfolders: all depths, special subfolders skipped and named', async () => {
  globalThis.messenger = fakeMessenger(tree, msgs);
  const r = await folderMessageIds(inbox, { subfolders: true });
  assert.deepEqual(r.ids.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(r.skipped, ['Trash']);
});

test('a special folder the user clicked on purpose is included', async () => {
  globalThis.messenger = fakeMessenger(tree, msgs);
  const r = await folderMessageIds({ id: 'f4', name: 'Trash', specialUse: ['trash'] });
  assert.deepEqual(r.ids, [9]);
});

test('reading stops at the user\'s limit; duplicates count once', async () => {
  globalThis.messenger = fakeMessenger(tree, { ...msgs, f2: [1, 2, 6] });
  const r = await folderMessageIds(inbox, { subfolders: true, limit: 6 });
  assert.equal(r.ids.length, 6);
  assert.equal(r.more, true);
  assert.equal(new Set(r.ids).size, 6);
});

test('a limit of zero or less reads nothing', async () => {
  globalThis.messenger = fakeMessenger(tree, msgs);
  for (const limit of [0, -3]) {
    const r = await folderMessageIds(inbox, { limit });
    assert.deepEqual(r.ids, []);
  }
});
