import { localized } from 'summermail-exports';

export type SmartSearchFilter = {
  token: string;
  term: string;
  label: string;
};

export type SmartSearchInterpretation = {
  query: string;
  text: string;
  filters: SmartSearchFilter[];
};

type InterpretOptions = {
  // "to" is too common in plain sentences ("how to apply") to treat as a
  // recipient filter unless the following word is a known person.
  isKnownPerson?: (word: string) => boolean;
};

type Match = { consumed: number; filter?: SmartSearchFilter };

const FOLDER_ROLES: Record<string, string> = {
  inbox: 'inbox',
  sent: 'sent',
  trash: 'trash',
  spam: 'spam',
  junk: 'spam',
  drafts: 'drafts',
  archive: 'archive',
};

const FILLER_WORDS = new Set([
  'a',
  'about',
  'all',
  'an',
  'any',
  'containing',
  'email',
  'emails',
  'find',
  'for',
  'mail',
  'mails',
  'mentioning',
  'message',
  'messages',
  'regarding',
  'show',
  'that',
  'the',
  'with',
]);

const DATE_UNITS: Record<string, string> = {
  day: 'day',
  days: 'day',
  week: 'week',
  weeks: 'week',
  month: 'month',
  months: 'month',
  year: 'year',
  years: 'year',
};

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(k|kb|m|mb|g|gb)?$/i;
const LARGE_SIZE = '5M';
const ATTACHMENT_WORDS = new Set(['attachment', 'attachments', 'attached']);
const SIZED_NOUNS = new Set([
  'attachment',
  'attachments',
  'email',
  'emails',
  'file',
  'files',
  'message',
  'messages',
]);

// Splits text into words while keeping "quoted phrases" whole.
export function smartSearchWords(text: string) {
  return text.match(/"[^"]*"?|\S+/g) || [];
}

const quoteTerm = (term: string) => (/\s/.test(term) ? `"${term.replace(/"/g, '')}"` : term);

const filter = (token: string, term: string, label: string): SmartSearchFilter => ({
  token,
  term,
  label,
});

const pluralUnit = (count: string, unit: string) => `${count} ${unit}${count === '1' ? '' : 's'}`;

const isCapitalized = (word?: string) => !!word && /^[A-Z][a-z'’-]+$/.test(word);

function sizeTerm(words: string[], index: number): [string, number] | null {
  const joined = SIZE_PATTERN.exec(words[index] || '');
  if (joined && joined[2]) {
    return [`${joined[1]}${joined[2][0].toUpperCase()}`, 1];
  }
  const unit = /^(k|kb|m|mb|g|gb)$/i.exec(words[index + 1] || '');
  if (joined && unit) {
    return [`${joined[1]}${unit[1][0].toUpperCase()}`, 2];
  }
  return null;
}

function matchDate(w: string[], i: number): Match | null {
  if (w[i] === 'today')
    return { consumed: 1, filter: filter('since', 'today', localized('Today')) };
  if (w[i] === 'yesterday') {
    return { consumed: 1, filter: filter('since', 'yesterday', localized('Since yesterday')) };
  }
  if (w[i] === 'recent' || w[i] === 'recently') {
    return { consumed: 1, filter: filter('since', 'last week', localized('Past week')) };
  }
  if (['this', 'past', 'last'].includes(w[i]) && ['week', 'month', 'year'].includes(w[i + 1])) {
    return {
      consumed: 2,
      filter: filter('since', `last ${w[i + 1]}`, localized('Past %@', w[i + 1])),
    };
  }
  if (['past', 'last'].includes(w[i]) && /^\d+$/.test(w[i + 1] || '') && DATE_UNITS[w[i + 2]]) {
    const span = pluralUnit(w[i + 1], DATE_UNITS[w[i + 2]]);
    return { consumed: 3, filter: filter('since', `${span} ago`, localized('Past %@', span)) };
  }
  if (w[i] === 'older' && w[i + 1] === 'than' && /^\d+$/.test(w[i + 2] || '')) {
    const unit = DATE_UNITS[w[i + 3]];
    if (!unit) return null;
    const span = pluralUnit(w[i + 2], unit);
    return {
      consumed: 4,
      filter: filter('before', `${span} ago`, localized('Older than %@', span)),
    };
  }
  return null;
}

function matchSize(w: string[], i: number): Match | null {
  const comparative = ['larger', 'bigger'].includes(w[i]) && w[i + 1] === 'than';
  const offset = comparative ? 2 : w[i] === 'over' ? 1 : 0;
  if (offset) {
    const size = sizeTerm(w, i + offset);
    if (size) {
      return {
        consumed: offset + size[1],
        filter: filter('larger', size[0], localized('Larger than %@', size[0])),
      };
    }
  }
  // "large attachments" keeps the noun so it can become its own filter.
  if (['large', 'big', 'huge'].includes(w[i]) && SIZED_NOUNS.has(w[i + 1])) {
    return {
      consumed: 1,
      filter: filter('larger', LARGE_SIZE, localized('Larger than %@', LARGE_SIZE)),
    };
  }
  return null;
}

function matchPerson(w: string[], raw: string[], i: number, options: InterpretOptions) {
  if (w[i] !== 'from' && w[i] !== 'to') return null;
  const next = raw[i + 1];
  if (!next || next.includes(':') || FILLER_WORDS.has(w[i + 1])) return null;
  if (w[i + 1] === 'me') {
    // Only "from me" maps onto a mailbox concept; "to me" is just noise.
    return w[i] === 'from'
      ? { consumed: 2, filter: filter('in', 'sent', localized('Sent by me')) }
      : { consumed: 2 };
  }
  const fullName = isCapitalized(next) && isCapitalized(raw[i + 2]);
  const person = (fullName ? `${next} ${raw[i + 2]}` : next).replace(/"/g, '');
  if (w[i] === 'to' && !person.includes('@') && !options.isKnownPerson?.(person.toLowerCase())) {
    return null;
  }
  const label = w[i] === 'from' ? localized('From %@', person) : localized('To %@', person);
  return { consumed: fullName ? 3 : 2, filter: filter(w[i], person, label) };
}

function matchWord(w: string[], raw: string[], i: number, options: InterpretOptions): Match {
  const date = matchDate(w, i);
  if (date) return date;
  const size = matchSize(w, i);
  if (size) return size;
  const person = matchPerson(w, raw, i, options);
  if (person) return person;

  if (ATTACHMENT_WORDS.has(w[i]) || (w[i] === 'with' && w[i + 1] === 'files')) {
    return {
      consumed: w[i] === 'with' ? 2 : 1,
      filter: filter('has', 'attachment', localized('Has attachment')),
    };
  }
  if (w[i] === 'unread')
    return { consumed: 1, filter: filter('is', 'unread', localized('Unread')) };
  if (w[i] === 'starred' || w[i] === 'flagged') {
    return { consumed: 1, filter: filter('is', 'starred', localized('Starred')) };
  }
  if (w[i] === 'in' && FOLDER_ROLES[w[i + 1]]) {
    const role = FOLDER_ROLES[w[i + 1]];
    return { consumed: 2, filter: filter('in', role, localized('In %@', raw[i + 1])) };
  }
  return { consumed: 0 };
}

/*
 * Reads everyday phrasing such as "invoices from Dana last week with
 * attachments" and proposes the equivalent structured query. Returns null when
 * nothing in the text maps to a filter, so plain searches are left alone.
 */
export function interpretNaturalLanguageQuery(
  query: string,
  options: InterpretOptions = {}
): SmartSearchInterpretation | null {
  // Explicit boolean structure is the user's own; don't rewrite around it.
  if (/[()]|\b(?:OR|NOT)\b/.test(query)) return null;

  const raw = smartSearchWords(query);
  const words = raw.map((word) => (word.startsWith('"') ? word : word.toLowerCase()));
  const textWords: string[] = [];
  const explicitFilters: string[] = [];
  const filters: SmartSearchFilter[] = [];

  for (let i = 0; i < raw.length; ) {
    if (!raw[i].startsWith('"') && raw[i].includes(':')) {
      explicitFilters.push(raw[i]);
      i++;
      continue;
    }
    const match = matchWord(words, raw, i, options);
    if (match.consumed === 0) {
      textWords.push(raw[i]);
      i++;
      continue;
    }
    if (
      match.filter &&
      !filters.some((f) => f.token === match.filter.token && f.term === match.filter.term)
    ) {
      filters.push(match.filter);
    }
    i += match.consumed;
  }

  if (filters.length === 0) return null;

  const text = textWords.filter((word) => !FILLER_WORDS.has(word.toLowerCase())).join(' ');
  const filterText = filters.map((f) => `${f.token}:${quoteTerm(f.term)}`);
  return {
    query: [text, ...explicitFilters, ...filterText].filter(Boolean).join(' '),
    text,
    filters,
  };
}
