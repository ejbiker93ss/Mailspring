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
});
