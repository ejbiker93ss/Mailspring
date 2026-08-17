import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';

import MTestUtils from '../../../spec/mailspring-test-utils';
import { EventPopoverActions } from '../lib/core/event-popover-actions';

describe('EventPopoverActions', () => {
  class Wrapper extends React.Component<React.ComponentProps<typeof EventPopoverActions>> {
    render() {
      return <EventPopoverActions {...this.props} />;
    }
  }

  it('shows a direct Delete action for existing writable events', () => {
    const onDelete = jasmine.createSpy('onDelete');
    const component = MTestUtils.renderIntoDocument(
      <Wrapper onSave={() => {}} onCancel={() => {}} onDelete={onDelete} />
    ) as unknown as Wrapper;
    const root = ReactDOM.findDOMNode(component) as HTMLElement;
    const deleteButton = root.querySelector('.event-delete-button') as HTMLButtonElement;

    expect(deleteButton).not.toBeNull();
    expect(deleteButton.textContent).toContain('Delete');
    ReactTestUtils.Simulate.click(deleteButton);
    expect(onDelete).toHaveBeenCalled();
  });

  it('does not show Delete when no delete handler is supplied', () => {
    const component = MTestUtils.renderIntoDocument(
      <Wrapper onSave={() => {}} onCancel={() => {}} />
    ) as unknown as Wrapper;
    const root = ReactDOM.findDOMNode(component) as HTMLElement;

    expect(root.querySelector('.event-delete-button')).toBeNull();
  });
});
