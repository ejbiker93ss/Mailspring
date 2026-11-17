import { SearchQueryParser } from 'summermail-exports';
import { interpretNaturalLanguageQuery } from '../lib/natural-language-query';

const queryFor = (text: string, known: string[] = []) =>
  interpretNaturalLanguageQuery(text, { isKnownPerson: (w) => known.includes(w) })?.query;

describe('interpretNaturalLanguageQuery', function () {
  it('turns everyday phrasing into filters', function () {
    expect(queryFor('invoices from john last week with attachments')).toBe(
      'invoices from:john since:"last week" has:attachment'
    );
  });

  it('leaves plain searches alone', function () {
    expect(interpretNaturalLanguageQuery('quarterly budget review')).toBe(null);
  });

  it('only reads "to" as a recipient for known people or addresses', function () {
    expect(queryFor('how to apply')).toBe(undefined);
    expect(queryFor('notes to dana unread', ['dana'])).toBe('notes to:dana is:unread');
    expect(queryFor('contract to legal@example.com yesterday')).toBe(
      'contract to:legal@example.com since:yesterday'
    );
  });

  it('keeps capitalized full names together', function () {
    expect(queryFor('from Dana Scully today')).toBe('from:"Dana Scully" since:today');
  });

  it('understands relative ranges, sizes, folders and "from me"', function () {
    expect(queryFor('photos past 3 months')).toBe('photos since:"3 months ago"');
    expect(queryFor('older than 2 years in trash')).toBe('before:"2 years ago" in:trash');
    expect(queryFor('large attachments')).toBe('larger:5M has:attachment');
    expect(queryFor('logs larger than 10 mb')).toBe('logs larger:10M');
    expect(queryFor('starred from me')).toBe('is:starred in:sent');
  });

  it('keeps explicit filters and quoted phrases', function () {
    expect(queryFor('subject:report "from home" unread')).toBe(
      '"from home" subject:report is:unread'
    );
  });

  it('does not rewrite queries with explicit boolean structure', function () {
    expect(interpretNaturalLanguageQuery('(a OR b) unread')).toBe(null);
  });

  it('produces queries the search parser accepts', function () {
    const query = queryFor('invoices from Dana Scully past 2 weeks larger than 1mb in inbox');
    expect(() => SearchQueryParser.parse(query)).not.toThrow();
  });
});
