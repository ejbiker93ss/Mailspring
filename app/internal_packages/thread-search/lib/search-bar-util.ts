import {
  localized,
  CategoryStore,
  DatabaseStore,
  SearchQueryParser,
  Thread,
  ContactStore,
} from 'summermail-exports';

// start of string or preceding whitespace
// a known token
// one of:
// - whitespace
// - end of string
// - a colon, optional space, and optional word
const searchTokens = [
  'in',
  'is',
  'since',
  'subject',
  'body',
  'from',
  'to',
  'has',
  'before',
  'after',
  'size',
  'larger',
  'smaller',
];
const tokenPrefixes = [
  ...new Set(
    searchTokens.flatMap((token) =>
      Array.from({ length: token.length }, (_, index) => token.slice(0, index + 1))
    )
  ),
]
  .sort((a, b) => b.length - a.length)
  .join('|');
export const TokenAndTermRegexp = () =>
  new RegExp(`(^|\\s)(${tokenPrefixes})(?::? ?$|: ?("[^"]*"?|[^\\s]+))`, 'gi');

export const LearnMoreURL = process.env.SUMMERMAIL_HELP_URL || '';

export const rankOfRole = (role: string) => {
  const rank = ['inbox', 'important', 'snoozed', 'sent', 'all', 'spam', 'trash'].indexOf(role);
  return rank !== -1 ? 20 - rank : -1000;
};

export const wrapInQuotes = (s: string) => `"${s.replace(/"/g, '')}"`;

export const getThreadSuggestions = async (term: string, accountIds: string[]) => {
  let dbQuery = DatabaseStore.findAll<Thread>(Thread)
    .structuredSearch(SearchQueryParser.parse(`subject:${wrapInQuotes(term)}`))
    .order(Thread.attributes.lastMessageReceivedTimestamp.descending())
    .limit(10);

  if (Array.isArray(accountIds) && accountIds.length > 0) {
    dbQuery = dbQuery.where(Thread.attributes.accountId.in(accountIds));
  }

  return dbQuery.background().then((results) => results);
};

export const getContactSuggestions = async (term: string, accountIds: string[]) => {
  const results = [];
  const contacts = term
    ? await ContactStore.searchContacts(term, { limit: 5 })
    : await ContactStore.topContacts({ limit: 5 });

  contacts.forEach((c) => results.push(c.email, c.name));

  return [...new Set(results)].filter((r) => r.toLowerCase().startsWith(term.toLowerCase()));
};

export const getCategorySuggestions = async (term: string, accountIds: string[]) =>
  [
    ...new Set(
      CategoryStore.categories()
        .filter((c) => accountIds.includes(c.accountId))
        .sort((a, b) => rankOfRole(b.role) - rankOfRole(a.role))
        .map((c) => c.displayName)
    ),
  ]
    .filter((s) => s.toLowerCase().startsWith(term))
    .slice(0, 8);

export const TokenSuggestions = [
  {
    token: 'from',
    term: '',
    description: localized('an email address'),
    termSuggestions: getContactSuggestions,
  },
  {
    token: 'to',
    term: '',
    description: localized('an email address'),
    termSuggestions: getContactSuggestions,
  },
  {
    token: 'in',
    term: '',
    description: localized('folder or label'),
    termSuggestions: getCategorySuggestions,
  },
  {
    token: 'before',
    term: '',
    description: localized('date received or range'),
    termSuggestions: ['yesterday', '2 days ago', 'last week', 'last month', '>=2018/05/31'],
  },
  {
    token: 'since',
    term: '',
    description: localized('date received or range'),
    termSuggestions: ['yesterday', '2 days ago', 'last week', 'last month', '>=2018/05/31'],
  },
  {
    token: 'after',
    hidden: true,
    term: '',
    description: localized('date received or range'),
    termSuggestions: ['yesterday', '2 days ago', 'last week', 'last month', '>=2018/05/31'],
  },
  {
    token: 'is',
    term: '',
    description: 'unread, starred',
    termSuggestions: ['unread', 'starred'],
  },
  {
    token: 'has',
    term: '',
    description: 'attachment',
    termSuggestions: ['attachment'],
  },
  {
    token: 'subject',
    term: '',
    description: localized('an email subject'),
    termSuggestions: [],
  },
  {
    token: 'body',
    term: '',
    description: localized('text in the message body'),
    termSuggestions: [],
  },
  ...['larger', 'smaller', 'size'].map((token) => ({
    token,
    hidden: false,
    term: '',
    description: localized('message size, e.g. 10M'),
    termSuggestions: ['1M', '5M', '10M', '25M'],
  })),
];

export const TokenSuggestionsForEmpty = TokenSuggestions.filter((t) => !t.hidden);

export function getCurrentTokenAndTerm(query: string, insertionIndex: number) {
  const regexp = TokenAndTermRegexp();
  const queryWithSpaces = query.replace(/\s/g, ' ');

  let next = null;
  while ((next = regexp.exec(queryWithSpaces))) {
    if (next.index <= insertionIndex && next.index + next[0].length >= insertionIndex) {
      return {
        token: next[2],
        term: (next[3] || '').replace(/"$/, '').replace(/^"/, '').toLowerCase(),
        index: next.index,
        length: next[0].length,
      };
    }
  }
  return { token: null, term: null, index: -1, length: 0 };
}
