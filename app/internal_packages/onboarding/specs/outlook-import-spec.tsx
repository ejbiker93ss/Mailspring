import React from 'react';
import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { ipcRenderer } from 'electron';
import { AccountStore } from 'summermail-exports';
import OutlookImportPanel from '../lib/outlook-import-panel';
import {
  pendingOutlookAccounts,
  pendingOutlookKey,
  savePendingOutlookAccounts,
} from '../lib/pending-outlook-accounts';
import { normalizeOutlookAccounts, outlookAccountSetup } from '../../../src/outlook-import';
import { discoverOutlookAccounts } from '../../../src/browser/outlook-account-discovery';

describe('Outlook account import', () => {
  const fixture = {
    emailAddress: 'alice@example.com',
    name: 'Alice',
    kind: 'imap',
    imap_host: 'mail.example.com',
  };
  let container: HTMLDivElement;
  let platform: PropertyDescriptor;
  let previousPending: unknown;
  beforeEach(() => {
    platform = Object.getOwnPropertyDescriptor(process, 'platform');
    previousPending = AppEnv.config.get(pendingOutlookKey);
    AppEnv.config.set(pendingOutlookKey, []);
    container = document.createElement('div');
    document.body.appendChild(container);
    spyOn(AccountStore, 'accounts').andReturn([]);
  });
  afterEach(() => {
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    container.remove();
    Object.defineProperty(process, 'platform', platform);
    AppEnv.config.set(pendingOutlookKey, previousPending || []);
  });
  const render = (resume = () => {}) =>
    act(() => {
      ReactDOM.render(<OutlookImportPanel onResume={resume} />, container);
    });

  it('merges duplicate profiles and excludes credentials and invalid addresses', () => {
    const result = normalizeOutlookAccounts([
      {
        ...fixture,
        emailAddress: 'ALICE@example.com',
        imap_port: 993,
        imap_password: 'do-not-copy',
      },
      { ...fixture, kind: 'exchange', smtp_host: 'smtp.example.com', refresh_token: 'do-not-copy' },
      { emailAddress: 'invalid' },
    ]);
    expect(result.length).toBe(1);
    expect(result[0].settings.imap_host).toBe('mail.example.com');
    expect(result[0].settings.smtp_host).toBe('smtp.example.com');
    expect(JSON.stringify(result).includes('do-not-copy')).toBe(false);
    expect(result[0].kind).toBe('exchange');
  });
  it('preserves imported servers and supplies editable secure defaults', () => {
    const account = normalizeOutlookAccounts([fixture])[0];
    const setup = outlookAccountSetup(account, 'imap');
    expect(setup.settings.imap_host).toBe('mail.example.com');
    expect(setup.settings.smtp_port).toBe(587);
    expect(setup.settings.smtp_security).toBe('STARTTLS');
    expect(setup.settings.imap_password).toBeUndefined();
    expect(outlookAccountSetup(account, 'office365').settings).toEqual({});
  });
  for (const os of ['darwin', 'linux'] as const) {
    it(`hides discovery on ${os} and bypasses Windows APIs`, async () => {
      Object.defineProperty(process, 'platform', { value: os });
      spyOn(ipcRenderer, 'invoke');
      render();
      expect(container.textContent).toBe('');
      expect(ipcRenderer.invoke).not.toHaveBeenCalled();
      const result: any = await discoverOutlookAccounts(os);
      expect(result.supported).toBe(false);
      expect(result.accounts).toEqual([]);
    });
  }
  it('persists pending setup across remounts without starting mail sync', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    spyOn(AccountStore, 'addAccount');
    savePendingOutlookAccounts(normalizeOutlookAccounts([fixture]));
    render();
    expect(container.textContent).toContain('Needs sign-in');
    act(() => {
      ReactDOM.unmountComponentAtNode(container);
    });
    render();
    expect(container.textContent).toContain('alice@example.com');
    expect(AccountStore.addAccount).not.toHaveBeenCalled();
    act(() => Simulate.click(container.querySelector('button[aria-label]')));
    expect(pendingOutlookAccounts()).toEqual([]);
  });
  it('resumes a migrated pending account on macOS without discovery controls', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    savePendingOutlookAccounts(normalizeOutlookAccounts([fixture]));
    const resume = jasmine.createSpy('resume');
    render(resume);
    expect(container.textContent).not.toContain('Import from Outlook');
    const signIn = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Sign in'
    );
    act(() => Simulate.click(signIn));
    expect(resume).toHaveBeenCalled();
    expect(pendingOutlookAccounts().length).toBe(1);
  });
  it('excludes accounts that are already connected', () => {
    savePendingOutlookAccounts(normalizeOutlookAccounts([fixture]));
    (AccountStore.accounts as jasmine.Spy).andReturn([{ emailAddress: 'ALICE@example.com' }]);
    render();
    expect(container.textContent).not.toContain('Needs sign-in');
  });
  it('explains empty scans and new Outlook limitations', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    spyOn(ipcRenderer, 'invoke').andReturn(Promise.resolve({ accounts: [], supported: true }));
    render();
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(container.textContent).toContain('No classic Outlook accounts were found');
    expect(container.textContent).toContain('new Outlook');
  });
  it('recovers from failed detection', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    spyOn(ipcRenderer, 'invoke').andReturn(Promise.reject(new Error('timeout')));
    render();
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(container.textContent).toContain('Could not read Outlook accounts');
    expect(container.querySelector('button').disabled).toBe(false);
  });

  it('imports only selected new accounts and resumes their saved server settings', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    (AccountStore.accounts as jasmine.Spy).andReturn([{ emailAddress: 'existing@example.com' }]);
    spyOn(ipcRenderer, 'invoke').andReturn(
      Promise.resolve({ accounts: [fixture, { ...fixture, emailAddress: 'existing@example.com' }] })
    );
    spyOn(AccountStore, 'addAccount');
    const resume = jasmine.createSpy('resume');
    render(resume);
    await act(async () => Simulate.click(container.querySelector('button')));
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(1);
    const checkbox = container.querySelector('input') as HTMLInputElement;
    checkbox.checked = true;
    act(() => Simulate.change(checkbox));
    const importButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Import selected'
    );
    act(() => Simulate.click(importButton));
    expect(pendingOutlookAccounts().length).toBe(1);
    expect(AccountStore.addAccount).not.toHaveBeenCalled();
    const signIn = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Sign in'
    );
    act(() => Simulate.click(signIn));
    expect(resume.mostRecentCall.args[0].settings.imap_host).toBe('mail.example.com');
  });
});
