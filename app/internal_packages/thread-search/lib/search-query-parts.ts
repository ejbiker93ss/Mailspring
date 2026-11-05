import { TokenSuggestions } from './search-bar-util';

export type SearchQueryPart = {
  start: number;
  end: number;
  text: string;
  token?: string;
  term?: string;
};

const operators = new Set(TokenSuggestions.map((suggestion) => suggestion.token));

export function searchQueryParts(query: string): SearchQueryPart[] {
  const parts: SearchQueryPart[] = [];
  let textStart = 0;
  let index = 0;
  while (index < query.length) {
    const match =
      (index === 0 || /[\s(]/.test(query[index - 1])) &&
      /^([a-z]+): *("(?:\\.|[^"\\])*"?|[^\s()]*)/i.exec(query.slice(index));
    if (match && operators.has(match[1].toLowerCase())) {
      if (index > textStart) {
        parts.push({ start: textStart, end: index, text: query.slice(textStart, index) });
      }
      const end = index + match[0].length;
      parts.push({
        start: index,
        end,
        text: match[0],
        token: match[1].toLowerCase(),
        term: match[2].replace(/^"|"$/g, ''),
      });
      index = end;
      textStart = end;
      continue;
    }
    // Keep operator-looking words inside quoted free text as plain text.
    if (query[index] === '"') {
      index++;
      while (index < query.length && query[index] !== '"') {
        index += query[index] === '\\' ? 2 : 1;
      }
    }
    index++;
  }
  parts.push({ start: textStart, end: query.length, text: query.slice(textStart) });
  return parts;
}

export function replaceSearchQueryPart(query: string, part: SearchQueryPart, text: string) {
  return query.slice(0, part.start) + text + query.slice(part.end);
}

export function removeSearchQueryPart(query: string, part: SearchQueryPart): string {
  let before = query.slice(0, part.start);
  let after = query.slice(part.end);
  const opening = /\(\s*$/.exec(before);
  const closing = /^\s*\)/.exec(after);
  // Remove a now-empty group together with its connecting AND/OR.
  if (opening && closing) {
    return removeSearchQueryPart(query, {
      start: opening.index,
      end: part.end + closing[0].length,
      text: '',
    });
  }
  const precedingOperator = /\b(?:(?:AND|OR)\s+(?:NOT\s+)?|NOT\s+)$/i;
  if (precedingOperator.test(before)) {
    before = before.replace(precedingOperator, '');
  } else {
    after = after.replace(/^\s*(?:AND|OR)\b\s*/i, '');
  }
  return (before + after).trim();
}
