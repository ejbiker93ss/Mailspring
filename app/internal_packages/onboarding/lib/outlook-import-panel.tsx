import React from 'react';
import { ipcRenderer } from 'electron';
import { Account, AccountStore, localized } from 'summermail-exports';
import {
  normalizeOutlookAccounts,
  OutlookAccount,
  outlookAccountSetup,
  outlookAccountProvider,
} from '../../../src/outlook-import';
import {
  pendingOutlookAccounts,
  pendingOutlookKey,
  savePendingOutlookAccounts,
  removePendingOutlookAccount,
} from './pending-outlook-accounts';

export default function OutlookImportPanel({ onResume }: { onResume: (account: Account) => void }) {
  const [pending, setPending] = React.useState(pendingOutlookAccounts);
  const [accounts, setAccounts] = React.useState<OutlookAccount[]>([]);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [providers, setProviders] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [connected, setConnected] = React.useState(() => AccountStore.accounts());
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    const subscription = AppEnv.config.onDidChange(pendingOutlookKey, () =>
      setPending(pendingOutlookAccounts())
    );
    const unsubscribe = AccountStore.listen(() => setConnected(AccountStore.accounts()));
    return () => {
      mounted.current = false;
      subscription.dispose();
      unsubscribe();
    };
  }, []);

  const connectedEmails = new Set(connected.map((account) => account.emailAddress.toLowerCase()));
  const saved = pending.filter((account) => !connectedEmails.has(account.emailAddress));
  const savedEmails = new Set(saved.map((account) => account.emailAddress));
  const available = accounts.filter(
    (account) =>
      !connectedEmails.has(account.emailAddress) && !savedEmails.has(account.emailAddress)
  );

  const discover = async () => {
    setBusy(true);
    setMessage('');
    setAccounts([]);
    setSelected([]);
    try {
      const result = await ipcRenderer.invoke('discover-outlook-accounts');
      if (!mounted.current) return;
      const found = normalizeOutlookAccounts(result.accounts);
      setAccounts(found);
      if (result.partial) {
        setMessage(
          localized(
            'Some Outlook profiles could not be read. You can retry with classic Outlook open, or add an account manually.'
          )
        );
      } else if (!found.length) {
        setMessage(
          localized(
            'No classic Outlook accounts were found. If you use new Outlook, add your account using the regular setup options. You can also retry with classic Outlook open.'
          )
        );
      } else if (
        found.every(
          (account) =>
            connectedEmails.has(account.emailAddress) || savedEmails.has(account.emailAddress)
        )
      ) {
        setMessage(localized('These Outlook accounts are already connected or saved for setup.'));
      }
    } catch {
      if (mounted.current)
        setMessage(
          localized('Could not read Outlook accounts. Try again, or add your account manually.')
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const save = () => {
    const added = available.filter((account) => selected.includes(account.emailAddress));
    savePendingOutlookAccounts([...pendingOutlookAccounts(), ...added]);
    setPending(pendingOutlookAccounts());
    setSelected([]);
    setMessage(
      localized(
        'Accounts saved. Choose Sign in when you are ready. Mail sync starts only after setup is complete.'
      )
    );
  };

  // Pending setup remains usable if a profile is migrated to another platform.
  // Discovery itself has no UI or startup cost on macOS and Linux.
  if (process.platform !== 'win32' && !saved.length) return null;

  return (
    <section className="outlook-import-panel" aria-label={localized('Imported account setup')}>
      {process.platform === 'win32' && (
        <>
          <button className="btn" disabled={busy} onClick={discover}>
            {busy ? localized('Looking for accounts…') : localized('Import from Outlook')}
          </button>
          <p>
            {localized(
              'Import account settings from classic Outlook on this PC. Sign in later; passwords and local mail are not imported.'
            )}
          </p>
        </>
      )}
      <div role="status" aria-live="polite">
        {message}
      </div>
      {available.length > 0 && (
        <fieldset>
          <legend>{localized('Choose accounts to import')}</legend>
          {available.map((account) => (
            <label key={account.emailAddress} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={selected.includes(account.emailAddress)}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...selected, account.emailAddress]
                      : selected.filter((email) => email !== account.emailAddress)
                  )
                }
              />{' '}
              {account.name} — {account.emailAddress}
            </label>
          ))}
          <button className="btn btn-primary" disabled={!selected.length} onClick={save}>
            {localized('Import selected')}
          </button>
        </fieldset>
      )}
      {saved.length > 0 && <h3>{localized('Needs sign-in')}</h3>}
      {saved.map((account) => (
        <div key={account.emailAddress} style={{ marginBottom: 12 }}>
          <div>
            <strong>{account.emailAddress}</strong>
          </div>
          {account.kind === 'pop' && (
            <p>
              {localized(
                'This was a POP account. Choose a supported provider or review IMAP settings to connect. Local Outlook mail is not imported.'
              )}
            </p>
          )}
          {account.kind === 'exchange' && (
            <p>
              {localized(
                'For an on-premises Exchange account, choose IMAP / SMTP if your administrator has enabled it.'
              )}
            </p>
          )}
          <label>
            {localized('Connect using')}{' '}
            <select
              value={providers[account.emailAddress] || outlookAccountProvider(account)}
              onChange={(event) =>
                setProviders({ ...providers, [account.emailAddress]: event.target.value })
              }
            >
              <option value="imap">IMAP / SMTP</option>
              <option value="office365">Microsoft 365</option>
              <option value="outlook">Outlook.com</option>
              <option value="gmail">Gmail / Google Workspace</option>
              <option value="smartermail">SmarterMail</option>
            </select>
          </label>{' '}
          <button
            className="btn"
            onClick={() =>
              onResume(
                new Account(
                  outlookAccountSetup(
                    account,
                    providers[account.emailAddress] || outlookAccountProvider(account)
                  )
                )
              )
            }
          >
            {localized('Sign in')}
          </button>{' '}
          <button
            className="btn"
            aria-label={localized('Remove %@ from setup', account.emailAddress)}
            onClick={() => removePendingOutlookAccount(account.emailAddress)}
          >
            {localized('Remove')}
          </button>
        </div>
      ))}
    </section>
  );
}
