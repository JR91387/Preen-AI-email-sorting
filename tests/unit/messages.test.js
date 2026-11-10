// SPDX-License-Identifier: PolyForm-Shield-1.0.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEmailMeta } from '../../apps/thunderbird/mail/messages.js';
import { createMessenger } from '../mocks/messenger.js';

test('getEmailMeta restores "Re: " prefix from raw Subject header', async () => {
  const { messenger } = createMessenger({
    messages: {
      1: {
        header: {
          id: 1,
          subject: 'book club',
          author: 'alice@example.com',
          date: new Date('2026-01-01'),
          folder: { accountId: 'acc1' },
        },
        full: {
          headers: {
            subject: ['Re: book club'],
          },
        },
      },
    },
  });
  globalThis.messenger = messenger;

  const meta = await getEmailMeta(1);
  assert.equal(meta.subject, 'Re: book club');
});

test('getEmailMeta uses header.subject when raw header is unrelated', async () => {
  const { messenger } = createMessenger({
    messages: {
      1: {
        header: {
          id: 1,
          subject: 'book club',
          author: 'alice@example.com',
          date: new Date('2026-01-01'),
          folder: { accountId: 'acc1' },
        },
        full: {
          headers: {
            subject: ['something else entirely'],
          },
        },
      },
    },
  });
  globalThis.messenger = messenger;

  const meta = await getEmailMeta(1);
  assert.equal(meta.subject, 'book club');
});

test('getEmailMeta uses header.subject when Subject header is missing', async () => {
  const { messenger } = createMessenger({
    messages: {
      1: {
        header: {
          id: 1,
          subject: 'book club',
          author: 'alice@example.com',
          date: new Date('2026-01-01'),
          folder: { accountId: 'acc1' },
        },
        full: {
          headers: {},
        },
      },
    },
  });
  globalThis.messenger = messenger;

  const meta = await getEmailMeta(1);
  assert.equal(meta.subject, 'book club');
});

test('getEmailMeta uses header.subject when Subject contains RFC 2047 encoded words', async () => {
  const { messenger } = createMessenger({
    messages: {
      1: {
        header: {
          id: 1,
          subject: 'Booked',
          author: 'alice@example.com',
          date: new Date('2026-01-01'),
          folder: { accountId: 'acc1' },
        },
        full: {
          headers: {
            subject: ['=?utf-8?B?UmU6IGJvb2sgY2x1Yg==?='],
          },
        },
      },
    },
  });
  globalThis.messenger = messenger;

  const meta = await getEmailMeta(1);
  assert.equal(meta.subject, 'Booked');
});
