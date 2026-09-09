import React, { useEffect, useRef, useState } from 'react';
import { Account, AccountStore, localized } from 'summermail-exports';
import { ConvertibleAccountType, verifyAccountTypeChange } from '../account-type-change';

export default function AccountTypeControl({
  account,
  onVerified,
}: {
  account: Account;
  onVerified: (candidate: Account) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<ConvertibleAccountType>(
    account.provider === 'imap' ? 'smartermail' : 'imap'
  );
  const [server, setServer] = useState(
    account.settings.smartermail_server || `https://${account.settings.imap_host || ''}`
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      active.current = false;
    },
    []
  );
  if (account.provider !== 'imap' && account.provider !== 'smartermail') return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const originalSettings = JSON.stringify(account.settings);
    const originalProvider = account.provider;
    try {
      const candidate = await verifyAccountTypeChange(account, provider, server);
      if (!active.current) return;
      const current = AccountStore.accountForId(account.id);
      if (
        !current ||
        current.provider !== originalProvider ||
        JSON.stringify(current.settings) !== originalSettings
      ) {
        throw new Error(
          localized(
            'The account settings changed during verification. Reopen this form and try again.'
          )
        );
      }
      onVerified(candidate);
      setEditing(false);
    } catch (e) {
      if (active.current)
        setError(e.message || localized('Verification failed. Your account type has not changed.'));
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  };

  return (
    <div className="account-type-settings">
      <h6>{localized('Account Type')}</h6>
      {!editing ? (
        <div className="account-type-actions">
          <span>{account.provider === 'smartermail' ? 'SmarterMail' : 'IMAP'}</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setProvider(account.provider === 'imap' ? 'smartermail' : 'imap');
              setError('');
              setEditing(true);
            }}
          >
            {localized('Change account type…')}
          </button>
        </div>
      ) : (
        <form onSubmit={save} aria-busy={busy}>
          <label htmlFor="account-type-target">{localized('Change to')}</label>
          <select
            id="account-type-target"
            value={provider}
            disabled={busy}
            onChange={(e) => setProvider(e.target.value as ConvertibleAccountType)}
          >
            <option value={account.provider === 'imap' ? 'smartermail' : 'imap'}>
              {account.provider === 'imap' ? 'SmarterMail' : 'IMAP'}
            </option>
          </select>
          {provider === 'smartermail' && (
            <>
              <label htmlFor="account-type-server">{localized('SmarterMail server')}</label>
              <input
                id="account-type-server"
                type="text"
                required
                value={server}
                disabled={busy}
                placeholder="https://mail.example.com"
                onChange={(e) => setServer(e.target.value)}
              />
            </>
          )}
          <p className="account-calendar-help">
            {provider === 'smartermail'
              ? localized(
                  'Verify your saved login, then use this server for calendars and contacts. Existing mail, folders and account preferences are kept.'
                )
              : localized(
                  'Keep your existing mail connection, calendars, contacts and account preferences. The SmarterMail webmail shortcut will be removed.'
                )}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="account-type-actions">
            <button type="submit" className="btn btn-emphasis" disabled={busy}>
              {busy ? localized('Verifying…') : localized('Verify and Change Type')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>
              {localized('Cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
