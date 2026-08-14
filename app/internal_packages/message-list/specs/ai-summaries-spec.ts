import fs from 'fs';
import os from 'os';
import path from 'path';
import { Contact, Message } from 'mailspring-exports';
import { buildThreadSummaryTranscript } from '../lib/ai-summary-client';
import { ComposerSupport } from 'mailspring-component-kit';
import { convertFromHTML } from '../../../src/components/composer-editor/conversion';
import {
  AiSummaryStore,
  normalizeSummaryText,
  quotedSummaryContentHash,
} from '../lib/ai-summary-store';

describe('AISummaries', () => {
  let directory: string;
  let store: AiSummaryStore;
  const scope = { username: 'Account-A', mailbox: 'Alice@Example.com' };

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-summaries-spec-'));
    store = new AiSummaryStore(path.join(directory, 'summaries.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('upserts thread summaries within an account and mailbox scope', () => {
    store.putThreadSummary(scope, 'thread-1', 'Subject', 'First summary', 3);
    store.putThreadSummary(scope, 'thread-1', 'Subject', 'Updated summary', 4);

    expect(store.getThreadSummary(scope, 'thread-1').summary).toBe('Updated summary');
    expect(store.getThreadSummary(scope, 'thread-1').messageCount).toBe(4);
    expect(
      store.getThreadSummary({ username: 'other', mailbox: 'alice@example.com' }, 'thread-1')
    ).toBe(null);
  });

  it('shares quoted summaries only when normalized content and scope match', () => {
    store.putQuotedSummary(scope, 'On Monday, Alice wrote:\n  Hello', 'Saved quote summary');

    expect(store.getQuotedSummary(scope, ' On Monday, Alice wrote:   Hello ').summary).toBe(
      'Saved quote summary'
    );
    expect(
      store.getQuotedSummary(
        { username: 'Account-A', mailbox: 'bob@example.com' },
        'On Monday, Alice wrote: Hello'
      )
    ).toBe(null);
    expect(quotedSummaryContentHash('A\n B')).toBe(quotedSummaryContentHash(' A B '));
    expect(normalizeSummaryText(' A\n B ')).toBe('A B');
  });

  it('builds chronological, bounded transcripts and redacts personal information', () => {
    const sender = new Contact({ name: 'Alice Example', email: 'alice@example.com' });
    const later = new Message({
      id: 'later',
      accountId: 'Account-A',
      threadId: 'thread-1',
      from: [sender],
      date: new Date('2026-08-14T12:00:00Z'),
      body: `<p>${'x'.repeat(22000)}</p>`,
    });
    const earlier = new Message({
      id: 'earlier',
      accountId: 'Account-A',
      threadId: 'thread-1',
      from: [sender],
      date: new Date('2026-08-13T12:00:00Z'),
      body: '<p>Email alice@example.com</p>',
    });
    const transcript = buildThreadSummaryTranscript([later, earlier], true);

    expect(transcript.indexOf('2026-08-13')).toBeLessThan(transcript.indexOf('2026-08-14'));
    expect(transcript).not.toContain('alice@example.com');
    expect(transcript).not.toContain('Alice Example');
    expect(transcript.length).toBeLessThan(41000);
  });

  it('extracts only the quoted history from a reply composer', () => {
    const value = convertFromHTML(
      '<p>My reply</p><blockquote><p>First quoted line</p><blockquote>Nested quote</blockquote></blockquote>'
    );
    const quoteText = ComposerSupport.BaseBlockPlugins.quotedTextFromValue(value);

    expect(quoteText).toContain('First quoted line');
    expect(quoteText).toContain('Nested quote');
    expect(quoteText).not.toContain('My reply');
    expect(quoteText.match(/Nested quote/g).length).toBe(1);
  });
});
