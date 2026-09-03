import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';

import UnthreadedState from '../../../src/flux/stores/unthreaded-state';
import ThreadListControls from '../lib/thread-list-controls';

describe('ThreadListControls', () => {
  let controls = null;
  let root = null;
  let originalSortAscending = false;
  let originalUnreadOnly = false;

  beforeEach(() => {
    originalSortAscending = UnthreadedState.sortAscending();
    originalUnreadOnly = UnthreadedState.unreadOnly();
    (UnthreadedState as any)._sortAscending = false;
    (UnthreadedState as any)._unreadOnly = false;

    controls = ReactTestUtils.renderIntoDocument(<ThreadListControls />) as any;
    root = ReactDOM.findDOMNode(controls) as HTMLElement;
  });

  afterEach(() => {
    if (root && root.parentNode) {
      ReactDOM.unmountComponentAtNode(root.parentNode as Element);
    }
    (UnthreadedState as any)._sortAscending = originalSortAscending;
    (UnthreadedState as any)._unreadOnly = originalUnreadOnly;
  });

  it('applies sort and unread changes from its buttons', () => {
    const buttons = root.querySelectorAll('button');

    expect(buttons[0].getAttribute('type')).toBe('button');
    expect(buttons[1].getAttribute('type')).toBe('button');

    ReactTestUtils.Simulate.click(buttons[0]);
    expect(UnthreadedState.sortAscending()).toBe(true);
    expect(buttons[0].getAttribute('title')).toBe('Sort by Date (ascending)');

    ReactTestUtils.Simulate.click(buttons[1]);
    expect(UnthreadedState.unreadOnly()).toBe(true);
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('title')).toBe('Show all messages');
  });
});
