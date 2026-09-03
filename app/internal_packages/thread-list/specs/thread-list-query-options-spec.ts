import ModelQuery from '../../../src/flux/models/query';
import { Thread } from '../../../src/flux/models/thread';
import { queryWithThreadListOptions } from '../lib/thread-list-query-options';

describe('thread list query options', () => {
  it('applies ascending date order and unread filtering to the standard threaded query', () => {
    const source = new ModelQuery<Thread[]>(Thread, {} as any)
      .where(Thread.attributes.categories.contains('inbox'))
      .limit(50);

    // Perspective subscriptions finalize their source query before the thread
    // list applies toolbar options. Exercise that same path here.
    source.sql();

    const sql = queryWithThreadListOptions(source, {
      isSent: false,
      sortAscending: true,
      unreadOnly: true,
    }).sql();

    expect(sql).toContain('`ThreadCategory`.`unread` != 0');
    expect(sql).toContain('`ThreadCategory`.`lastMessageReceivedTimestamp`) ASC');
  });

  it('uses the sent timestamp when sorting Sent', () => {
    const source = new ModelQuery<Thread[]>(Thread, {} as any).limit(50);
    source.sql();

    const sql = queryWithThreadListOptions(source, {
      isSent: true,
      sortAscending: false,
      unreadOnly: false,
    }).sql();

    expect(sql).toContain('`Thread`.`lastMessageSentTimestamp` DESC');
  });
});
