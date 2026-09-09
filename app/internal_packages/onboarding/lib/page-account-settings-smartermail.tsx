import React from 'react';
import { localized, Account, RegExpUtils } from 'summermail-exports';

import CreatePageForForm from './decorators/create-page-for-form';
import FormField from './form-field';
import { buildSmarterMailAccount, normalizeSmarterMailServerURL } from './onboarding-helpers';

interface AccountSmarterMailSettingsFormProps {
  account: Account;
  errorFieldNames: string[];
  submitting: boolean;
  onConnect: (account: Account) => void;
  onFieldChange: (event: { target: { id: string; value: string } }) => void;
  onFieldKeyPress: () => void;
}

class AccountSmarterMailSettingsForm extends React.Component<AccountSmarterMailSettingsFormProps> {
  static displayName = 'AccountSmarterMailSettingsForm';

  static submitLabel = () => localized('Connect Account');

  static titleLabel = () => localized('Add your SmarterMail account');

  static subtitleLabel = () =>
    localized('Enter the HTTPS address of your SmarterMail server and your account credentials.');

  static validateAccount = (account: Account) => {
    const errorFieldNames: string[] = [];
    let errorMessage = null;
    const { smartermail_server, imap_password } = account.settings;

    if (!account.name || !account.emailAddress || !smartermail_server || !imap_password) {
      return { errorMessage, errorFieldNames, populated: false };
    }
    if (!RegExpUtils.emailRegex().test(account.emailAddress)) {
      errorFieldNames.push('emailAddress');
      errorMessage = localized('Please provide a valid email address.');
    }
    try {
      normalizeSmarterMailServerURL(smartermail_server);
    } catch (err) {
      errorFieldNames.push('settings.smartermail_server');
      errorMessage = err.message;
    }

    return { errorMessage, errorFieldNames, populated: errorFieldNames.length === 0 };
  };

  submit() {
    this.props.onConnect(buildSmarterMailAccount(this.props.account));
  }

  _suggestedServer = '';

  onEmailBlur = () => {
    const { account, onFieldChange } = this.props;
    const email = account.emailAddress.trim();
    if (!RegExpUtils.emailRegex().test(email)) return;

    const server = account.settings.smartermail_server;
    if (server && server !== this._suggestedServer) return;

    this._suggestedServer = `https://mail.${email.split('@')[1].toLowerCase()}`;
    onFieldChange({
      target: { id: 'settings.smartermail_server', value: this._suggestedServer },
    });
  };

  render() {
    return (
      <form className="settings">
        <FormField field="name" title={localized('Name')} {...this.props} />
        <FormField
          field="emailAddress"
          title={localized('Email')}
          {...this.props}
          onBlur={this.onEmailBlur}
        />
        <FormField
          field="settings.smartermail_server"
          title={localized('SmarterMail Server')}
          placeholder="https://mail.example.com"
          {...this.props}
        />
        <FormField
          field="settings.imap_password"
          title={localized('Mail password (IMAP/SMTP)')}
          type="password"
          {...this.props}
        />
        <FormField
          field="settings.caldav_password"
          title={localized('WebDAV password (Calendar / Contacts)')}
          type="password"
          {...this.props}
        />
        <p>
          {localized(
            'With two-factor authentication, enter the separate IMAP/SMTP and WebDAV app passwords from SmarterMail. Do not enter a one-time code. Without two-factor authentication, you can leave WebDAV blank to use the mail password.'
          )}
        </p>
      </form>
    );
  }
}

export default CreatePageForForm(AccountSmarterMailSettingsForm);
