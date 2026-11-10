// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// A small in-memory stand-in for Thunderbird's `messenger` API, for tests of
// modules that call it. Only what Preen uses is implemented.
// Thunderbird's own permissions are enforced where Preen needs an optional one
// (moving mail), so a missing permission fails here as it does in Thunderbird.

import { readFileSync } from 'node:fs';

const MANIFEST_PERMISSIONS = JSON.parse(readFileSync(new URL('../../apps/thunderbird/manifest.json', import.meta.url), 'utf8')).permissions;

/**
 * @param {object} opts
 * @param {Record<number, {header: object, full: object, textParts?: object[]}>} opts.messages
 * @param {boolean} [opts.permissionGranted]
 * @param {{key: string, tag: string, color: string}[]} [opts.tags] existing tags
 * @param {string[]} [opts.contacts] email addresses in the address book
 * @param {object[]} [opts.folders] MailFolder objects (id, accountId, specialUse…)
 * @param {string[]} [opts.optionalGranted] optional Thunderbird permissions already allowed (e.g. messagesMove)
 */
export function createMessenger({
  messages, permissionGranted = true, tags = [], contacts = [], folders = [], optionalGranted = [],
}) {
  const granted = new Set([...MANIFEST_PERMISSIONS, ...optionalGranted]);
  const require = (permission) => {
    if (!granted.has(permission)) throw new Error(`Missing permission: ${permission}`);
  };
  const store = {};
  const calls = {
    listInlineTextParts: [], getFull: [], update: [], tagsCreate: [], contactsQuery: [], query: [], sent: [], convert: [],
  };
  const alarms = new Map();
  const tagList = [...tags];

  const message = (id) => {
    if (!messages[id]) throw new Error(`Message ${id} not found`);
    return messages[id];
  };

  const messenger = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            if (key in store) out[key] = structuredClone(store[key]);
          }
          return out;
        },
        async set(values) {
          for (const [k, v] of Object.entries(values)) store[k] = structuredClone(v);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
        },
      },
    },
    permissions: {
      async contains({ origins = [], permissions = [] } = {}) {
        return (origins.length === 0 || permissionGranted) && permissions.every((p) => granted.has(p));
      },
    },
    messages: {
      async get(id) {
        // Like Thunderbird's MessageHeader, include the message's id.
        const header = message(id).header;
        header.id ??= Number(id);
        return header;
      },
      // Query by folder (and optional date) or by Message-ID header. One page.
      async query(info) {
        calls.query.push(info);
        const found = Object.entries(messages)
          .filter(([, m]) => !info.folderId || m.header.folder?.id === info.folderId)
          .filter(([, m]) => !info.headerMessageId || m.header.headerMessageId === info.headerMessageId)
          .filter(([, m]) => !info.fromDate || new Date(m.header.date) >= new Date(info.fromDate))
          .map(([id, m]) => ({ id: Number(id), ...m.header }));
        return { id: null, messages: found };
      },
      async continueList() {
        return { id: null, messages: [] };
      },
      async abortList() {},
      async getFull(id, options) {
        calls.getFull.push({ id, options });
        return message(id).full;
      },
      async listAttachments() {
        return [];
      },
      async listInlineTextParts(id) {
        calls.listInlineTextParts.push(id);
        return message(id).textParts ?? [];
      },
      async update(id, props) {
        calls.update.push({ id, props });
        const known = new Set(tagList.map((t) => t.key));
        for (const key of props.tags ?? []) {
          if (!known.has(key)) throw new Error(`Unknown tag: ${key}`);
        }
        Object.assign(message(id).header, props);
      },
      // Moving puts the folder object on the message, like Thunderbird's MessageHeader.folder.
      async move(ids, folderId) {
        require('messagesMove');
        calls.move = [...(calls.move ?? []), { ids, folderId }];
        const target = folders.find((f) => f.id === folderId);
        if (!target) throw new Error(`No folder ${folderId}`);
        for (const id of ids) message(id).header.folder = { ...target };
      },
      tags: {
        async list() {
          return tagList.map((t) => ({ ...t }));
        },
        async update(key, props) {
          calls.tagsUpdate = [...(calls.tagsUpdate ?? []), { key, props }];
          const t = tagList.find((x) => x.key === key);
          if (!t) throw new Error(`No tag ${key}`);
          Object.assign(t, props);
        },
        async create(key, tag, color) {
          calls.tagsCreate.push(key);
          if (tagList.some((t) => t.key === key)) throw new Error(`Tag exists: ${key}`);
          tagList.push({ key, tag, color });
          return key;
        },
      },
    },
    addressBooks: {
      contacts: {
        async query({ searchString }) {
          calls.contactsQuery.push(searchString);
          return contacts
            .filter((email) => email.includes(searchString))
            .map((email, i) => ({ id: `c${i}`, type: 'contact', vCard: `BEGIN:VCARD\r\nVERSION:4.0\r\nEMAIL;PREF=1:${email}\r\nEND:VCARD\r\n` }));
        },
      },
    },
    folders: {
      async query({ accountId, path, specialUse } = {}) {
        return folders.filter((f) => (!accountId || f.accountId === accountId) && (!path || f.path === path)
          && (!specialUse || specialUse.every((u) => (f.specialUse ?? []).includes(u))));
      },
    },
    alarms: {
      async clear(name) {
        return alarms.delete(name);
      },
      create(name, info) {
        alarms.set(name, info);
      },
      async get(name) {
        return alarms.get(name);
      },
    },
    runtime: {
      async sendMessage(message) {
        calls.sent.push(message);
      },
    },
    messengerUtilities: {
      async convertToPlainText(html) {
        calls.convert.push(html.length);
        return html.replace(/<[^>]+>/g, '');
      },
    },
  };
  return { messenger, store, calls, alarms };
}
