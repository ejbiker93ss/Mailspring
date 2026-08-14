import { Contact, Message, Thread } from 'mailspring-exports';

import {
  buildAliasMap,
  addAliasesFromSerializedMail,
  emptyAliasMap,
  redactText,
  resolveAliases,
  sanitizeThreadForAI,
} from '../lib/mail-assistant-privacy';

describe('MailAssistantPrivacy', () => {
  const sender = new Contact({ name: 'Alice Example', email: 'alice@example.com' });
  const recipient = new Contact({ name: 'Bob Example', email: 'bob@example.com' });
  const message = new Message({
    id: 'message-1',
    accountId: 'account-1',
    threadId: 'thread-1',
    from: [sender],
    to: [recipient],
    date: new Date('2026-08-11T15:00:00Z'),
    body: '<p>Alice Example: email bob@example.com, call +1 (312) 555-1212, or visit https://example.com/private.</p>',
  });
  const thread = new Thread({
    id: 'thread-1',
    accountId: 'account-1',
    subject: 'Follow up with Alice Example at alice@example.com',
  });

  it('removes identifiers from thread content before it leaves the app', () => {
    const result = sanitizeThreadForAI(thread, [message], true);

    expect(result.text).not.toContain('alice@example.com');
    expect(result.text).not.toContain('bob@example.com');
    expect(result.text).not.toContain('Alice Example');
    expect(result.text).not.toContain('312');
    expect(result.text).not.toContain('https://example.com');
    expect(result.text).toContain('[EMAIL_1]');
    expect(result.text).toContain('[URL_REDACTED]');
  });

  it('can send metadata without sending message text', () => {
    const result = sanitizeThreadForAI(thread, [message], false);

    expect(result.text).not.toContain('call');
    expect(result.text).not.toContain('Text:');
    expect(result.text).toContain('Message 1:');
  });

  it('can preserve original identities when privacy filtering is disabled', () => {
    const result = sanitizeThreadForAI(thread, [message], true, false);

    expect(result.text).toContain('Alice Example <alice@example.com>');
    expect(result.text).toContain('bob@example.com');
    expect(result.aliases.aliasesByEmail.size).toBe(0);
  });

  it('redacts identities consistently in mailbox tool results', () => {
    const aliases = emptyAliasMap();
    const output = JSON.stringify({
      from: [{ name: 'Carol Example', email: 'carol@example.com' }],
      body: 'Call Carol Example at 312-555-9999 or visit https://example.com/private',
    });

    addAliasesFromSerializedMail(output, aliases);
    const result = redactText(output, aliases);

    expect(result).toContain('[EMAIL_1]');
    expect(result).toContain('[PERSON_1]');
    expect(result).not.toContain('Carol Example');
    expect(result).not.toContain('carol@example.com');
    expect(result).not.toContain('312-555-9999');
  });

  it('redacts identifiers typed directly into chat', () => {
    const aliases = buildAliasMap([message]);
    const result = redactText('Please email outside@example.net or call 312-555-9999', aliases);

    expect(result).toBe('Please email [EMAIL_REDACTED] or call [PHONE_REDACTED]');
  });

  it('resolves only known aliases for confirmed actions', () => {
    const aliases = buildAliasMap([message]);

    expect(resolveAliases(['EMAIL_1', '[EMAIL_2]', 'unknown@example.com'], aliases)).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('allows original recipient addresses only when privacy filtering is off', () => {
    const aliases = emptyAliasMap();

    expect(resolveAliases(['person@example.com'], aliases)).toEqual([]);
    expect(resolveAliases(['person@example.com'], aliases, true)).toEqual(['person@example.com']);
  });
});
