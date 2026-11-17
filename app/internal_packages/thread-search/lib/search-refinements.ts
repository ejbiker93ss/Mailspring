import { localized } from 'summermail-exports';
import { searchQueryParts, removeSearchQueryPart } from './search-query-parts';

export type SearchRefinement = {
  id: string;
  label: string;
  token: string;
  term: string;
  // Refinements in the same group replace each other, like date ranges.
  group?: string;
};

export const SearchRefinements: SearchRefinement[] = [
  { id: 'attachment', label: localized('Has attachment'), token: 'has', term: 'attachment' },
  { id: 'unread', label: localized('Unread'), token: 'is', term: 'unread' },
  {
    id: 'week',
    label: localized('Past 7 days'),
    token: 'since',
    term: '7 days ago',
    group: 'date',
  },
  {
    id: 'month',
    label: localized('Past 30 days'),
    token: 'since',
    term: '30 days ago',
    group: 'date',
  },
  {
    id: 'year',
    label: localized('Past year'),
    token: 'since',
    term: 'last year',
    group: 'date',
  },
  { id: 'large', label: localized('Larger than 5 MB'), token: 'larger', term: '5M' },
];

const sameTerm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const queryPartsFor = (query: string, refinement: SearchRefinement) =>
  searchQueryParts(query).filter((part) => part.token === refinement.token);

export function isRefinementActive(query: string, refinement: SearchRefinement) {
  return queryPartsFor(query, refinement).some((part) => sameTerm(part.term, refinement.term));
}

function removeMatchingParts(query: string, matches: (term: string) => boolean, token: string) {
  let next = query;
  // Remove from the end so earlier part offsets stay valid.
  const parts = searchQueryParts(next)
    .filter((part) => part.token === token && matches(part.term))
    .reverse();
  parts.forEach((part) => (next = removeSearchQueryPart(next, part)));
  return next;
}

export function toggleRefinement(query: string, refinement: SearchRefinement) {
  if (isRefinementActive(query, refinement)) {
    return removeMatchingParts(query, (term) => sameTerm(term, refinement.term), refinement.token);
  }
  let next = query;
  if (refinement.group) {
    SearchRefinements.filter((r) => r.group === refinement.group).forEach((r) => {
      next = removeMatchingParts(next, (term) => sameTerm(term, r.term), r.token);
    });
  }
  const term = /\s/.test(refinement.term) ? `"${refinement.term}"` : refinement.term;
  return [next.trim(), `${refinement.token}:${term}`].filter(Boolean).join(' ');
}
