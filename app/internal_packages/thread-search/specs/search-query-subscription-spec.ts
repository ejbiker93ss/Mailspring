import { DatabaseStore, SearchQueryParser } from 'summermail-exports';
import { SearchQuerySubscription } from '../lib/search-query-subscription';

describe('SearchQuerySubscription matching messages', () => {
  it('retains the message that satisfied an exact sender search', async () => {
    const subscription = Object.create(SearchQuerySubscription.prototype);
    subscription._accountIds = ['account-1'];

    const querySpy = (DatabaseStore as any)._query as jasmine.Spy;
    querySpy.andCallFake((sql: string) => {
      if (sql.startsWith('SELECT COUNT(*)')) {
        return Promise.resolve([{ count: 1 }]);
      }
      return Promise.resolve([
        {
          id: 'thread-1',
          matchingMessageId: 'message-2',
          exactMatches: 1,
          relevance: -1,
        },
      ]);
    });

    const result = await subscription._rankedSearchResults(
      SearchQueryParser.parse('from:"jerian.m@msseggs.com"')
    );

    expect(result.ids).toEqual(['thread-1']);
    expect(result.total).toBe(1);
    expect(result.matchingMessageIds.get('thread-1')).toBe('message-2');
    expect(querySpy.calls[0].args[0]).toContain('AS matchingMessageId');
  });

  it('falls back to chronological results when relevance ranking fails', async () => {
    const subscription = Object.create(SearchQuerySubscription.prototype);
    subscription._accountIds = ['account-1'];
    subscription._searchQuery = 'jerian';
    subscription._resultCount = null;
    subscription._matchingMessageIds = new Map([['old-thread', 'old-message']]);
    spyOn(subscription, '_rankedSearchResults').andReturn(
      Promise.reject(new Error('database disk image is malformed'))
    );
    spyOn(subscription, 'replaceQuery');

    await subscription.performLocalSearch();

    expect(subscription.replaceQuery).toHaveBeenCalled();
    expect(subscription._resultCount).toBe(null);
    expect(subscription._matchingMessageIds.size).toBe(0);
    expect(subscription.replaceQuery.calls[0].args[0].sql()).toContain(
      'ORDER BY `Thread`.`lastMessageReceivedTimestamp` DESC'
    );
  });

  it('generates a complete CASE expression for ranked result ordering', async () => {
    const subscription = Object.create(SearchQuerySubscription.prototype);
    subscription._accountIds = ['account-1'];
    subscription._searchQuery = 'jerian';
    subscription._resultCount = null;
    subscription._matchingMessageIds = new Map();
    spyOn(subscription, '_rankedSearchResults').andReturn(
      Promise.resolve({
        ids: ['thread-1', 'thread-2'],
        total: 2,
        matchingMessageIds: new Map(),
      })
    );
    spyOn(subscription, 'replaceQuery');

    await subscription.performLocalSearch();

    const sql = subscription.replaceQuery.calls[0].args[0].sql();
    expect(sql).toContain('ELSE 2 END) ASC');
  });
});
