import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Actions, ContactStore, DatabaseStore } from 'summermail-exports';

import { ThreadSearchBar } from '../lib/thread-search-bar';
import { rememberSearch, recentSearches } from '../lib/recent-searches';

const RECENT_KEY = 'summermail.search.recent';

const perspective = {
  accountIds: [],
  isInbox: () => true,
  categories: () => [],
  name: 'Inbox',
} as any;

function renderBar(query: string) {
  let bar: ThreadSearchBar;
  const utils = render(
    <ThreadSearchBar
      ref={(el) => (bar = el)}
      query={query}
      isSearching={false}
      resultCount={null}
      perspective={perspective}
    />
  );
  return { ...utils, bar };
}

describe('ThreadSearchBar', function () {
  beforeEach(function () {
    window.localStorage.removeItem(RECENT_KEY);
    spyOn(ContactStore, 'searchContacts').andReturn(Promise.resolve([]));
    const dbQuery: any = {};
    ['structuredSearch', 'order', 'limit', 'where'].forEach((m) => (dbQuery[m] = () => dbQuery));
    dbQuery.background = () => Promise.resolve([]);
    spyOn(DatabaseStore, 'findAll').andReturn(dbQuery);
  });

  afterEach(function () {
    cleanup();
    window.localStorage.removeItem(RECENT_KEY);
  });

  it('reports typed text, preserving capitalization', function () {
    spyOn(Actions, 'searchQueryChanged');
    const { container } = renderBar('');
    fireEvent.change(container.querySelector('.search-query-text'), {
      target: { value: 'HeLlO wOrLd' },
    });
    expect(Actions.searchQueryChanged).toHaveBeenCalledWith('HeLlO wOrLd');
  });

  it('preselects a smart reading of natural language so Enter applies it', async function () {
    spyOn(Actions, 'searchQuerySubmitted');
    const query = 'invoices from john last week';
    const { container, bar } = renderBar(query);
    fireEvent.focus(container.querySelector('.search-query-text'));
    await bar._generateSuggestionsForQuery(query);

    expect(bar.state.suggestions[0].kind).toBe('smart');
    expect(bar.state.suggestions[1].kind).toBe('literal');
    expect(bar.state.selectedIdx).toBe(0);
    expect(container.querySelector('.suggestion-smart').textContent).toContain('From john');

    fireEvent.keyDown(container.querySelector('.search-query-text'), { key: 'Enter' });
    expect(Actions.searchQuerySubmitted).toHaveBeenCalledWith(
      'invoices from:john since:"last week" '
    );
    expect(recentSearches()[0]).toBe('invoices from:john since:"last week"');
  });

  it('applies the reading to the current text when Enter beats the suggestions', async function () {
    spyOn(Actions, 'searchQuerySubmitted');
    const { container, bar } = renderBar('report unread starred');
    await bar._generateSuggestionsForQuery('report unread');

    fireEvent.keyDown(container.querySelector('.search-query-text'), { key: 'Enter' });
    expect(Actions.searchQuerySubmitted).toHaveBeenCalledWith('report is:unread is:starred ');
  });

  it('submits plain searches as typed', async function () {
    spyOn(Actions, 'searchQuerySubmitted');
    const { container, bar } = renderBar('quarterly budget');
    await bar._generateSuggestionsForQuery('quarterly budget');

    expect(bar.state.selectedIdx).toBe(-1);
    fireEvent.keyDown(container.querySelector('.search-query-text'), { key: 'Enter' });
    expect(Actions.searchQuerySubmitted).toHaveBeenCalledWith('quarterly budget');
  });

  it('offers recent searches before filters when the field is empty', async function () {
    rememberSearch('from:dana');
    rememberSearch('budget');
    const { container, bar } = renderBar('');
    fireEvent.focus(container.querySelector('.search-query-text'));
    await bar._generateSuggestionsForQuery('');

    const kinds = bar.state.suggestions.map((s) => s.kind);
    expect(kinds.slice(0, 2)).toEqual(['recent', 'recent']);
    expect(bar.state.suggestions[0].description).toBe('budget');
    expect(kinds).toContain('operator');

    fireEvent.mouseDown(container.querySelector('.suggestion-forget'));
    expect(recentSearches()).toEqual(['from:dana']);
  });

  it('toggles refinements in place', async function () {
    spyOn(Actions, 'searchQuerySubmitted');
    const { container, bar } = renderBar('invoices');
    fireEvent.focus(container.querySelector('.search-query-text'));
    await bar._generateSuggestionsForQuery('invoices');

    const attachment = Array.from(container.querySelectorAll('.search-refinement')).find(
      (el) => el.textContent === 'Has attachment'
    );
    fireEvent.click(attachment);
    expect(Actions.searchQuerySubmitted).toHaveBeenCalledWith('invoices has:attachment');
  });
});
