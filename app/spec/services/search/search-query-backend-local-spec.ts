import { SearchQueryParser } from '../../../src/services/search/search-query-parser';
import { compileFTSMatchQuery } from '../../../src/services/search/search-query-backend-local';

describe('LocalSearchQueryBackend relevance query', () => {
  it('preserves the from field restriction for ranking', () => {
    const ast = SearchQueryParser.parse('from:"jerian.m@msseggs.com"');

    expect(compileFTSMatchQuery(ast)).toBe('(from_ : "jerian.m@msseggs.com"*)');
  });

  it('preserves combined field restrictions for ranking', () => {
    const ast = SearchQueryParser.parse('from:jerian subject:grader');

    expect(compileFTSMatchQuery(ast)).toBe('((from_ : "jerian"*) AND (subject : "grader"*))');
  });

  it('does not create an FTS-only rank for mixed metadata searches', () => {
    const ast = SearchQueryParser.parse('from:jerian is:unread');

    expect(compileFTSMatchQuery(ast)).toBeNull();
  });
});
