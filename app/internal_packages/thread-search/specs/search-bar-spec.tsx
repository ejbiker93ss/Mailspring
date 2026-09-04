/*
 * decaffeinate suggestions:
 * DS102: Remove unnecessary code created because of implicit returns
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Actions } from 'summermail-exports';

import ThreadSearchBar, {
  ThreadSearchBar as ThreadSearchBarComponent,
} from '../lib/thread-search-bar';

describe('ThreadSearchBar', function () {
  afterEach(cleanup);

  beforeEach(function () {
    spyOn(AppEnv, 'isMainWindow').andReturn(true);
    this.searchBar = ReactTestUtils.renderIntoDocument(<ThreadSearchBar />);
    this.input = (ReactDOM.findDOMNode(this.searchBar) as HTMLElement).querySelector(
      '[contenteditable]'
    );
  });

  it('preserves capitalization on searches', function () {
    spyOn(Actions, 'searchQueryChanged');
    const test = 'HeLlO wOrLd';
    ReactTestUtils.Simulate.input(this.input, { target: { innerText: test } as any });
    expect(Actions.searchQueryChanged).toHaveBeenCalledWith(test);
  });

  it('submits the current editor value when Enter follows input before props update', function () {
    spyOn(Actions, 'searchQuerySubmitted');
    const query = 'from:aaron';

    ReactTestUtils.Simulate.input(this.input, { target: { innerText: query } as any });
    ReactTestUtils.Simulate.keyDown(this.input, { key: 'Enter', keyCode: 0 });

    expect(Actions.searchQuerySubmitted).toHaveBeenCalledWith(query);
  });

  it('shows long blurred queries as a complete, ellipsizable summary', function () {
    const query =
      'from:avery.long.email.address@example.com subject:"Quarterly production planning review"';
    const perspective = {
      accountIds: [],
      isInbox: () => true,
      searchQuery: query,
      name: 'Inbox',
    } as any;
    const { container } = render(
      <ThreadSearchBarComponent
        query={query}
        isSearching={false}
        resultCount={27}
        perspective={perspective}
      />
    );
    const summary = container.querySelector<HTMLElement>('.thread-search-query-summary');

    expect(summary.textContent).toBe(query);
    expect(summary.title).toBe(query);
    expect(container.querySelector('.thread-search-result-count').textContent).toBe('27 results');
  });

  it('restores the editable query when the compact summary is clicked', function () {
    const query = 'from:avery.long.email.address@example.com';
    const perspective = {
      accountIds: [],
      isInbox: () => true,
      searchQuery: query,
      name: 'Inbox',
    } as any;
    const { container } = render(
      <ThreadSearchBarComponent
        query={query}
        isSearching={false}
        resultCount={1}
        perspective={perspective}
      />
    );

    fireEvent.mouseDown(container.querySelector('.thread-search-query-summary'));

    expect(container.querySelector('.thread-search-query-summary')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[contenteditable]'));
    expect(container.querySelector('.thread-search-result-count').textContent).toBe('1 result');
  });
});
