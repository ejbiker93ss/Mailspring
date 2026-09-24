import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { Actions, Message, SendActionsStore } from 'summermail-exports';
import { SendActionButton } from '../lib/send-action-button';
import { ALWAYS_CHECK_GRAMMAR_CONFIG_KEY } from '../lib/composer-ai-actions';

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

  it('opens alternate send actions above the composer footer', () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);

    fireEvent.click(container.querySelector('.secondary-picker'));

    expect(container.querySelector('.button-dropdown').classList.contains('open-up')).toBe(true);
    expect(container.textContent).toContain('Good Send Action');
  });

  it('offers Send without checking when the automatic AI check is enabled', () => {
    const originalConfigGet = AppEnv.config.get.bind(AppEnv.config);
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === ALWAYS_CHECK_GRAMMAR_CONFIG_KEY ? true : originalConfigGet(key)
    );
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);

    fireEvent.click(container.querySelector('.secondary-picker'));

    expect(container.textContent).toContain('Send without checking');
  });

  it('hides Send without checking when the automatic AI check is disabled', () => {
    const originalConfigGet = AppEnv.config.get.bind(AppEnv.config);
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === ALWAYS_CHECK_GRAMMAR_CONFIG_KEY ? false : originalConfigGet(key)
    );
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
      GoodSendAction,
    ]);
    const container = renderButton(this.draft);

    fireEvent.click(container.querySelector('.secondary-picker'));

    expect(container.textContent).not.toContain('Send without checking');
  });

  it('sends normally without running the automatic AI check', () => {
    const originalConfigGet = AppEnv.config.get.bind(AppEnv.config);
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === ALWAYS_CHECK_GRAMMAR_CONFIG_KEY ? true : originalConfigGet(key)
    );
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
    ]);
    const beforeSend = jasmine.createSpy('beforeSend').andReturn(Promise.resolve(false));
    const container = renderButton(this.draft, { beforeSend });

    fireEvent.click(container.querySelector('.secondary-picker'));
    const item = Array.from(container.querySelectorAll('.menu .item')).find((node) =>
      node.textContent.includes('Send without checking')
    );
    fireEvent.mouseDown(item);

    expect(beforeSend).not.toHaveBeenCalled();
    expect(Actions.sendDraft).toHaveBeenCalledWith(this.draft.headerMessageId, {
      actionKey: 'send',
    });
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
    await Promise.resolve();
    expect(Actions.sendDraft).toHaveBeenCalled();
  });

  it('stops sending when the pre-send check finds corrections', async () => {
    spyOn(SendActionsStore, 'orderedSendActionsForDraft').andReturn([
      SendActionsStore.DefaultSendAction,
    ]);
    const beforeSend = jasmine.createSpy('beforeSend').andReturn(Promise.resolve(false));
    const container = renderButton(this.draft, { beforeSend });

    fireEvent.click(container.querySelector('.primary-item'));

    expect(beforeSend).toHaveBeenCalled();
    await Promise.resolve();
    expect(container.querySelector('.is-preparing-send')).toBeNull();
    expect(Actions.sendDraft).not.toHaveBeenCalled();
  });
});
