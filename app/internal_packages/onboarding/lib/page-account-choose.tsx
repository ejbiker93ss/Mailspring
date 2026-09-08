import React from 'react';
import { localized } from 'summermail-exports';
import { RetinaImg } from 'summermail-component-kit';
import * as OnboardingActions from './onboarding-actions';
import AccountProviders from './account-providers';
import OutlookImportPanel from './outlook-import-panel';

export default class AccountChoosePage extends React.Component<{ account?: object }> {
  static displayName = 'AccountChoosePage';

  _renderProviders() {
    return AccountProviders.map(({ icon, displayName, provider }) => (
      <div
        key={provider}
        className={`provider ${provider}`}
        onClick={() => OnboardingActions.chooseAccountProvider(provider)}
      >
        <div className="icon-container">
          <RetinaImg name={icon} mode={RetinaImg.Mode.ContentPreserve} className="icon" />
        </div>
        <span className="provider-name">{displayName}</span>
      </div>
    ));
  }

  render() {
    return (
      <div className="page account-choose">
        <h2>{localized('Connect an email account')}</h2>
        <div className="provider-list">{this._renderProviders()}</div>
        <OutlookImportPanel
          onResume={(account) => {
            OnboardingActions.setAccount(account);
            const page = {
              imap: 'imap',
              office365: 'o365',
              outlook: 'outlook',
              gmail: 'gmail',
              smartermail: 'smartermail',
            }[account.provider];
            OnboardingActions.moveToPage(`account-settings-${page}`);
          }}
        />
      </div>
    );
  }
}
