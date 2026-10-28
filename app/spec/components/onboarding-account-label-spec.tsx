import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { Account } from 'summermail-exports';
import SmarterMailSetup from '../../internal_packages/onboarding/lib/page-account-settings-smartermail';
import { buildSmarterMailAccount } from '../../internal_packages/onboarding/lib/onboarding-helpers';
import PreferencesAccountDetails from '../../internal_packages/preferences/lib/tabs/preferences-account-details';

describe('Account labels during setup', function () {
  let container: HTMLDivElement;

  beforeEach(function () {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(function () {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  function account(overrides: Partial<Account> = {}) {
    return new Account({
      id: 'label-regression',
      provider: 'smartermail',
      name: 'Info',
      emailAddress: '',
      settings: { smartermail_server: 'https://mail.example.com' },
      ...overrides,
    });
  }

  function setupAccount(value: Account) {
    let form: InstanceType<typeof SmarterMailSetup>;
    ReactDOM.render(
      <SmarterMailSetup
        account={value}
        ref={(instance) => {
          form = instance;
        }}
      />,
      container
    );
    return form;
  }

  function type(field: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`[id="${field}"]`);
    input.value = value;
    ReactTestUtils.Simulate.change(input);
  }

  it('keeps the default label in sync while a SmarterMail address is typed', function () {
    const form = setupAccount(account());
    const email = 'info@example.com';
    for (let length = 1; length <= email.length; length++) {
      type('emailAddress', email.slice(0, length));
    }
    expect(form.state.account.emailAddress).toBe(email);
    expect(form.state.account.label).toBe(email);
    const saved = buildSmarterMailAccount(form.state.account);
    expect(saved.label).toBe(email);
    expect(saved.name).toBe('Info');
  });

  it('updates a default label when the address is replaced or cleared', function () {
    const form = setupAccount(account({ emailAddress: 'old@example.com' }));
    type('emailAddress', 'new@example.com');
    expect(form.state.account.label).toBe('new@example.com');
    type('emailAddress', '');
    expect(form.state.account.label).toBe('');
    type('emailAddress', 'info@example.com');
    expect(form.state.account.label).toBe('info@example.com');
  });

  it('preserves a custom label when reconnecting with an updated address', function () {
    const form = setupAccount(account({ emailAddress: 'old@example.com', label: 'Information' }));
    type('emailAddress', 'info@example.com');
    expect(form.state.account.label).toBe('Information');
    expect(buildSmarterMailAccount(form.state.account).label).toBe('Information');
  });

  it('saves a complete replacement for an existing one-letter label', function () {
    const saved: Account[] = [];
    ReactDOM.render(
      <PreferencesAccountDetails
        account={account({ emailAddress: 'info@example.com', label: 'i' })}
        onAccountUpdated={(_previous, next) => saved.push(next.clone())}
      />,
      container
    );
    for (const label of ['I', 'In', 'Inf', 'Info']) type('account-label', label);
    ReactTestUtils.Simulate.blur(container.querySelector('#account-label'));
    expect(saved.length).toBe(1);
    expect(saved[0].label).toBe('Info');
    expect(saved[0].clone().label).toBe('Info');
    expect(saved[0].emailAddress).toBe('info@example.com');
  });
});
