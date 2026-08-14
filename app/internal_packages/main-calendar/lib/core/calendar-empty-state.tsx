import React from 'react';
import { Account, Actions, localized } from 'mailspring-exports';

export function CalendarEmptyState({ accounts = [] }: { accounts?: Account[] }) {
  const configuredAccounts = accounts.filter((account) => account.settings.caldav_host);
  const connectionConfigured = configuredAccounts.length > 0;

  const onOpenAccountPreferences = () => {
    Actions.switchPreferencesTab('Accounts');
    Actions.openPreferences();
  };

  const onRetry = async () => {
    for (const account of configuredAccounts) {
      await AppEnv.mailsyncBridge.forceRelaunchClient(account);
      AppEnv.mailsyncBridge.sendMessageToAccount(account.id, { type: 'sync-calendar' });
    }
  };

  return (
    <div className="calendar-empty-state">
      <div className="calendar-empty-state-content">
        <h2 className="calendar-empty-state-title">
          {connectionConfigured
            ? localized('Calendar Connection Failed')
            : localized('No Calendars')}
        </h2>
        <p className="calendar-empty-state-message">
          {connectionConfigured
            ? localized(
                'No calendars were discovered. For SmarterMail, confirm WebDAV service access is enabled for this user and that the URL and app password match the WebDAV card in SmarterMail.'
              )
            : localized(
                'None of your connected accounts provide calendars. Mailspring supports calendars from Gmail and other providers with CalDAV support.'
              )}
        </p>
        <div className="calendar-empty-state-actions">
          {connectionConfigured && (
            <button className="btn btn-large" onClick={onRetry}>
              {localized('Retry Connection')}
            </button>
          )}
          <button className="btn btn-large btn-emphasis" onClick={onOpenAccountPreferences}>
            {connectionConfigured
              ? localized('Review Calendar Settings')
              : localized('Add a Calendar Account')}
          </button>
        </div>
      </div>
    </div>
  );
}
