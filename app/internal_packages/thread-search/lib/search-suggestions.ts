import { ContactStore, DateUtils, Thread, localized } from 'summermail-exports';
import {
  TokenSuggestionsForEmpty,
  getContactSuggestions,
  getThreadSuggestions,
  wrapInQuotes,
} from './search-bar-util';
import {
  SmartSearchFilter,
  interpretNaturalLanguageQuery,
  smartSearchWords,
} from './natural-language-query';
import { recentSearches } from './recent-searches';

export type SuggestionKind =
  | 'smart'
  | 'literal'
  | 'recent'
  | 'operator'
  | 'value'
  | 'person'
  | 'message';

export type ThreadSearchSuggestion = {
  kind: SuggestionKind;
  term: string;
  description: string;
  token?: string | null;
  detail?: string;
  // The complete query that choosing this suggestion submits.
  query?: string;
  // The typed text a smart or literal suggestion was built from.
  source?: string;
  filters?: SmartSearchFilter[];
  thread?: Thread;
};

export const SuggestionSectionTitles: Partial<Record<SuggestionKind, string>> = {
  smart: localized('Smart search'),
  recent: localized('Recent searches'),
  operator: localized('Filters'),
  person: localized('People'),
  message: localized('Messages'),
};

const MAX_RECENT = 5;
const MAX_PEOPLE = 4;
const MAX_MESSAGES = 5;

export function emptyQuerySuggestions(): ThreadSearchSuggestion[] {
  const recents = recentSearches()
    .slice(0, MAX_RECENT)
    .map((query) => ({ kind: 'recent' as const, term: query, description: query, query }));
  return [...recents, ...operatorSuggestions(TokenSuggestionsForEmpty)];
}

export function operatorSuggestions(
  tokens: { token: string; description: string }[]
): ThreadSearchSuggestion[] {
  return tokens.map(({ token, description }) => ({
    kind: 'operator',
    token,
    term: '',
    description,
  }));
}

// Words that follow "to" are only recipients when they name someone the user
// actually corresponds with.
async function knownRecipients(text: string) {
  const words = smartSearchWords(text);
  const candidates = words
    .filter((_, i) => i > 0 && words[i - 1].toLowerCase() === 'to')
    .map((word) => word.replace(/"/g, '').toLowerCase())
    .filter((word) => word.length > 1);
  const known = new Set<string>();
  await Promise.all(
    candidates.map(async (word) => {
      const contacts = await ContactStore.searchContacts(word, { limit: 1 });
      if (contacts.length) known.add(word);
    })
  );
  return known;
}

async function peopleSuggestions(text: string, prefix: string, accountIds: string[]) {
  const contacts = await ContactStore.searchContacts(text, { limit: MAX_PEOPLE * 2 });
  const seen = new Set<string>();
  const people = contacts.filter((c) => {
    const email = (c.email || '').toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
  if (people.length === 0) {
    // Fall back to the name/email list used for from: completions.
    const names = await getContactSuggestions(text, accountIds);
    return names.slice(0, MAX_PEOPLE).map<ThreadSearchSuggestion>((name) => ({
      kind: 'person',
      term: name,
      description: name,
      query: `${prefix}from:${wrapInQuotes(name)} `,
    }));
  }
  return people.slice(0, MAX_PEOPLE).map<ThreadSearchSuggestion>((c) => ({
    kind: 'person',
    term: c.email,
    description: c.name && c.name !== c.email ? c.name : c.email,
    detail: c.name && c.name !== c.email ? c.email : undefined,
    query: `${prefix}from:${wrapInQuotes(c.email)} `,
  }));
}

async function messageSuggestions(text: string, prefix: string, accountIds: string[]) {
  const threads = await getThreadSuggestions(text, accountIds);
  return threads.slice(0, MAX_MESSAGES).map<ThreadSearchSuggestion>((t) => {
    const sender = t.participants?.find((p) => !p.isMe?.()) || t.participants?.[0];
    const when = t.lastMessageReceivedTimestamp
      ? DateUtils.shortTimeString(t.lastMessageReceivedTimestamp)
      : '';
    return {
      kind: 'message',
      term: wrapInQuotes(t.subject),
      description: t.subject || localized('(No Subject)'),
      detail: [sender?.name || sender?.email, when].filter(Boolean).join(' · '),
      query: `${prefix}${wrapInQuotes(t.subject)} `,
      thread: t,
    };
  });
}

/*
 * Suggestions for free text: a natural-language reading of the query first
 * (preselected, so Enter applies it), then people and matching messages.
 */
export async function freeTextSuggestions(
  text: string,
  prefix: string,
  accountIds: string[],
  { includeLookups }: { includeLookups: boolean }
): Promise<ThreadSearchSuggestion[]> {
  const recipients = await knownRecipients(text);
  const smart = interpretNaturalLanguageQuery(text, {
    isKnownPerson: (word) => recipients.has(word),
  });
  const suggestions: ThreadSearchSuggestion[] = [];
  if (smart) {
    suggestions.push(
      {
        kind: 'smart',
        term: smart.query,
        description: smart.text,
        filters: smart.filters,
        query: `${prefix}${smart.query} `,
        source: text,
      },
      {
        kind: 'literal',
        term: text,
        description: localized('Search for “%@” as typed', text.trim()),
        query: `${prefix}${text}`,
        source: text,
      }
    );
  }
  if (!includeLookups) return suggestions;

  const lookupText = (smart?.text || text).trim();
  if (lookupText.length < 2) return suggestions;
  const searchesForSender = smart?.filters.some((f) => f.token === 'from');
  const [people, messages] = await Promise.all([
    searchesForSender ? [] : peopleSuggestions(lookupText, prefix, accountIds),
    messageSuggestions(lookupText, prefix, accountIds),
  ]);
  return [...suggestions, ...people, ...messages];
}
