import React from 'react';
import { localized, Account, RegExpUtils } from 'mailspring-exports';

import CreatePageForForm from './decorators/create-page-for-form';
import FormField from './form-field';
import { buildSmarterMailAccount, normalizeSmarterMailServerURL } from './onboarding-helpers';

interface AccountSmarterMailSettingsFormProps {
  account: Account;
  errorFieldNames: string[];
  submitting: boolean;
  onConnect: (account: Account) => void;
  onFieldChange: () => void;
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

  render() {
    return (
      <form className="settings">
        <FormField field="name" title={localized('Name')} {...this.props} />
        <FormField field="emailAddress" title={localized('Email')} {...this.props} />
        <FormField
          field="settings.smartermail_server"
          title={localized('SmarterMail Server')}
          placeholder="https://mail.example.com"
          {...this.props}
        />
        <FormField
          field="settings.imap_password"
          title={localized('Password')}
          type="password"
          {...this.props}
        />
      </form>
    );
  }
}

export default CreatePageForForm(AccountSmarterMailSettingsForm);
