import React from 'react';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Actions, Message, SendActionsStore } from 'summermail-exports';
import { SendActionButton } from '../lib/send-action-button';

const GoodSendAction = {
  title: 'Good Send Action',
  configKey: 'good-send-action',
  isAvailableForDraft: () => true,
  performSendAction: () => {},
};

const SecondSendAction = {
  title: 'Second Send Action',
  configKey: 'second-send-action',
  isAvailableForDraft: () => true,
  performSendAction: () => {},
};

const NoIconUrl = {
  title: 'No Icon',
  configKey: 'no-icon',
  iconUrl: null,
  isAvailableForDraft: () => true,
  performSendAction() {},
};

describe('SendActionButton', function describeBlock() {
  afterEach(cleanup);

  beforeEach(() => {
    spyOn(Actions, 'sendDraft');
    this.isValidDraft = jasmine.createSpy('isValidDraft');
    this.id = 'client-23';
    this.draft = new Message({ id: this.id, draft: true, headerMessageId: 'bla' });
  });

  const renderButton = (
    draft,
    {
      isValid = true,
      beforeSend,
    }: { isValid?: boolean; beforeSend?: (anchor?: HTMLElement) => Promise<boolean> } = {}
  ) => {
    this.isValidDraft.andReturn(isValid);
    const { container } = render(
      <SendActionButton {...({ draft, isValidDraft: this.isValidDraft, beforeSend } as any)} />
    );
    return container;
  };

  it('renders without error', () => {
    const container = renderButton(this.draft);
    expect(container.querySelector('.button-dropdown') !== null).toBe(true);
  });

  it('is a dropdown', () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);
    expect(container.querySelector('.button-dropdown') !== null).toBe(true);
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelector('.primary-item').getAttribute('title')).toBe('Send');
  });

  it('has the correct primary item', () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SecondSendAction,
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);
    expect(container.querySelector('.primary-item').getAttribute('title')).toBe(
      'Second Send Action'
    );
  });

  it("still renders with a null iconUrl and doesn't show the image", () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      NoIconUrl,
      SendActionsStore.DefaultSendAction,
    ]);
    const container = renderButton(this.draft);
    expect(container.querySelector('.button-dropdown') !== null).toBe(true);
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('img').length).toBe(2);
  });

  it('sends a draft by default if no extra actions present', () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);
    fireEvent.click(container.querySelector('.primary-item'));
    expect(this.isValidDraft).toHaveBeenCalled();
    expect(Actions.sendDraft).toHaveBeenCalledWith(this.draft.headerMessageId, {
      actionKey: 'send',
    });
  });

  it("doesn't send a draft if the isValidDraft fails", () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft, { isValid: false });
    fireEvent.click(container.querySelector('.primary-item'));
    expect(this.isValidDraft).toHaveBeenCalled();
    expect(Actions.sendDraft).not.toHaveBeenCalled();
  });

  it('does the preferred action when more than one action present', () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      GoodSendAction,
      SendActionsStore.DefaultSendAction,
    ]);
    const container = renderButton(this.draft, {});
    fireEvent.click(container.querySelector('.primary-item'));
    expect(this.isValidDraft).toHaveBeenCalled();
    expect(Actions.sendDraft).toHaveBeenCalledWith(this.draft.headerMessageId, {
      actionKey: 'good-send-action',
    });
  });

  it('sends after an enabled pre-send check finds no issues', async () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
    ]);
    const beforeSend = jasmine.createSpy('beforeSend').andReturn(Promise.resolve(true));
    const container = renderButton(this.draft, { beforeSend });

    fireEvent.click(container.querySelector('.primary-item'));

    expect(beforeSend).toHaveBeenCalled();
    await waitFor(() => expect(Actions.sendDraft).toHaveBeenCalled());
  });

  it('stops sending when the pre-send check finds corrections', async () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
    ]);
    const beforeSend = jasmine.createSpy('beforeSend').andReturn(Promise.resolve(false));
    const container = renderButton(this.draft, { beforeSend });

    fireEvent.click(container.querySelector('.primary-item'));

    expect(beforeSend).toHaveBeenCalled();
    await waitFor(() => expect(container.querySelector('.is-preparing-send')).toBeNull());
    expect(Actions.sendDraft).not.toHaveBeenCalled();
  });
});
