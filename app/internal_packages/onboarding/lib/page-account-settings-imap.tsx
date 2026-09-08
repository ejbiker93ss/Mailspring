import { ipcRenderer } from 'electron';
import React from 'react';
import { localized, Account } from 'summermail-exports';
import CreatePageForForm from './decorators/create-page-for-form';
import FormField from './form-field';
import { emailDomain, imapCalendarDefaults } from './imap-setup-defaults';

const StandardIMAPPorts = [143, 993];
const StandardSMTPPorts = [25, 465, 587];

interface AccountIMAPSettingsFormProps {
  account: Account;
  errorFieldNames: string[];
  submitting: boolean;
  onConnect: () => void;
  onFieldChange: (
    event: { target: { id: string; value: any; type?: string; checked?: boolean } },
    opts?: { afterSetState: () => void }
  ) => void;
  onFieldKeyPress: () => void;
}

class AccountIMAPSettingsForm extends React.Component<AccountIMAPSettingsFormProps> {
  static displayName = 'AccountIMAPSettingsForm';

  static submitLabel = () => {
    return localized('Connect Account');
  };

  static titleLabel = () => {
    return localized('Set up Account');
  };

  static subtitleLabel = () => {
    return localized('Complete the IMAP and SMTP settings below to connect your account.');
  };

  static validateAccount = (account: Account) => {
    let errorMessage = null;
    const errorFieldNames = [];

    if (!account.settings[`imap_username`] || !account.settings[`imap_password`]) {
      return { errorMessage, errorFieldNames, populated: false };
    }

    // Note: we explicitly don't check that an SMTP username / password
    // is provided because occasionally those gateways don't require them!

    for (const type of ['imap', 'smtp']) {
      if (!account.settings[`${type}_host`]) {
        return { errorMessage, errorFieldNames, populated: false };
      }
      if (!Number.isInteger(account.settings[`${type}_port`] / 1)) {
        errorMessage = localized('Please provide a valid port number.');
        errorFieldNames.push(`${type}_port`);
      }
    }

    return { errorMessage, errorFieldNames, populated: true };
  };

  componentDidMount() {
    ipcRenderer.send('resize-window', { width: 1180, height: 660 });
    this.updateSettings(Object.entries(imapCalendarDefaults(this.props.account)));
  }

  updateSettings = (entries: [string, any][]) => {
    const [entry, ...remaining] = entries;
    if (!entry) return;
    this.props.onFieldChange(
      { target: { id: `settings.${entry[0]}`, value: entry[1] } },
      { afterSetState: () => this.updateSettings(remaining) }
    );
  };

  onMailFieldChange: AccountIMAPSettingsFormProps['onFieldChange'] = (event) => {
    const key = event.target.id.replace('settings.', '');
    const calendarKey = key.replace('imap_', 'caldav_');
    const { settings } = this.props.account;
    const copyToCalendar =
      ['imap_username', 'imap_password'].includes(key) &&
      (!settings[calendarKey] || settings[calendarKey] === settings[key]);
    this.props.onFieldChange(event, {
      afterSetState: () => {
        if (copyToCalendar) this.updateSettings([[calendarKey, event.target.value]]);
      },
    });
  };

  renderServerDropdown() {
    const { account, submitting } = this.props;
    const domain = emailDomain(account.emailAddress);
    if (!domain) return null;
    const { imap_host, smtp_host } = account.settings;
    const value =
      imap_host === `mail.${domain}` && smtp_host === `mail.${domain}`
        ? 'mail'
        : imap_host === `imap.${domain}` && smtp_host === `smtp.${domain}`
          ? 'separate'
          : 'custom';
    return (
      <span>
        <label htmlFor="server-preset">{localized('Server names')}:</label>
        <select
          id="server-preset"
          value={value}
          disabled={submitting}
          onChange={(event) => {
            if (event.target.value === 'custom') return;
            const shared = event.target.value === 'mail';
            this.updateSettings([
              ['imap_host', `${shared ? 'mail' : 'imap'}.${domain}`],
              ['smtp_host', `${shared ? 'mail' : 'smtp'}.${domain}`],
            ]);
          }}
        >
          <option value="separate">{`imap.${domain} / smtp.${domain}`}</option>
          <option value="mail">{`mail.${domain}`}</option>
          <option value="custom">{localized('Custom')}</option>
        </select>
      </span>
    );
  }

  renderPortDropdown(protocol) {
    if (!['imap', 'smtp'].includes(protocol)) {
      throw new Error(`Can't render port dropdown for protocol '${protocol}'`);
    }
    const {
      account: { settings },
      submitting,
      onFieldKeyPress,
      onFieldChange,
    } = this.props;

    const field = `${protocol}_port`;
    const values = protocol === 'imap' ? StandardIMAPPorts : StandardSMTPPorts;
    const isStandard = Number.isInteger(settings[field]) && values.includes(settings[field]);
    const customValue = isStandard ? '0' : settings[field];

    // When you change the port, automatically switch the security setting to
    // the standard for that port. Lots of people don't update that field and
    // are getting confused.
    const onPortChange = (event: { target: { value: string; id: string } }) => {
      const port = Number(event.target.value);

      onFieldChange(
        { target: { value: port, id: event.target.id } },
        {
          afterSetState: () => {
            if (port === 143 && settings.imap_security !== 'none') {
              onFieldChange({ target: { value: 'none', id: 'settings.imap_security' } });
            }
            if (port === 993 && settings.imap_security !== 'SSL / TLS') {
              onFieldChange({ target: { value: 'SSL / TLS', id: 'settings.imap_security' } });
            }
            if (port === 25 && settings.smtp_security !== 'none') {
              onFieldChange({ target: { value: 'none', id: 'settings.smtp_security' } });
            }
            if (port === 465 && settings.smtp_security !== 'SSL / TLS') {
              onFieldChange({ target: { value: 'SSL / TLS', id: 'settings.smtp_security' } });
            }
            if (port === 587 && settings.smtp_security !== 'STARTTLS') {
              onFieldChange({ target: { value: 'STARTTLS', id: 'settings.smtp_security' } });
            }
          },
        }
      );
    };

    return (
      <span>
        <label htmlFor={`settings.${field}`}>{localized('Port')}:</label>
        <select
          id={`settings.${field}`}
          tabIndex={0}
          value={settings[field]}
          disabled={submitting}
          onChange={onPortChange}
        >
          {values.map((v) => (
            <option value={v} key={v}>
              {v}
            </option>
          ))}
          <option value={customValue} key="custom">
            {localized('Custom')}
          </option>
        </select>
        {!isStandard && (
          <>
            <label htmlFor={`settings.${field}_custom`} className="sr-only">
              {localized('Custom Port')}
            </label>
            <input
              style={{
                width: 80,
                marginLeft: 6,
                height: 23,
              }}
              id={`settings.${field}_custom`}
              tabIndex={0}
              value={settings[field]}
              disabled={submitting}
              onKeyPress={onFieldKeyPress}
              onChange={(e) =>
                onPortChange({
                  target: { value: e.target.value, id: `settings.${field}` },
                })
              }
            />
          </>
        )}
      </span>
    );
  }

  renderSecurityDropdown(protocol) {
    const {
      account: { settings },
      submitting,
      onFieldKeyPress,
      onFieldChange,
    } = this.props;

    return (
      <div>
        <span>
          <label htmlFor={`settings.${protocol}_security`}>{localized('Security')}:</label>
          <select
            id={`settings.${protocol}_security`}
            tabIndex={0}
            value={settings[`${protocol}_security`]}
            disabled={submitting}
            onKeyPress={onFieldKeyPress}
            onChange={onFieldChange}
          >
            <option value="SSL / TLS" key="SSL / TLS">
              SSL / TLS
            </option>
            <option value="STARTTLS" key="STARTTLS">
              STARTTLS
            </option>
            <option value="none" key="none">
              {localized('None')}
            </option>
          </select>
        </span>
        <span style={{ paddingLeft: '20px', paddingTop: '10px' }}>
          <input
            type="checkbox"
            id={`settings.${protocol}_allow_insecure_ssl`}
            disabled={submitting}
            checked={settings[`${protocol}_allow_insecure_ssl`] || false}
            onKeyPress={onFieldKeyPress}
            onChange={onFieldChange}
          />
          <label htmlFor={`settings.${protocol}_allow_insecure_ssl`} className="checkbox">
            {localized('Allow insecure SSL')}
          </label>
        </span>
      </div>
    );
  }

  renderFieldsForType(type) {
    return (
      <div>
        <FormField field={`settings.${type}_host`} title={localized('Server')} {...this.props} />
        <div style={{ textAlign: 'left' }}>
          {this.renderPortDropdown(type)}
          {this.renderSecurityDropdown(type)}
        </div>
        <FormField
          field={`settings.${type}_username`}
          title={localized('Username')}
          {...this.props}
          onFieldChange={this.onMailFieldChange}
        />
        <FormField
          field={`settings.${type}_password`}
          title={localized('Password')}
          type="password"
          {...this.props}
          onFieldChange={this.onMailFieldChange}
        />
        {type === 'imap' && (
          <FormField
            field={`settings.container_folder`}
            title={localized('Custom Container Folder')}
            {...this.props}
          />
        )}
      </div>
    );
  }

  render() {
    return (
      <div>
        {this.renderServerDropdown()}
        <div className="twocol threecol">
          <div className="col">
            <div className="col-heading">{localized('Incoming Mail')} (IMAP):</div>
            {this.renderFieldsForType('imap')}
          </div>
          <div className="col">
            <div className="col-heading">{localized('Outgoing Mail')} (SMTP):</div>
            {this.renderFieldsForType('smtp')}
          </div>
          <div className="col">
            <div className="col-heading">{localized('Calendar')} (CalDAV):</div>
            <p>
              {localized(
                'Calendar settings are filled from your email domain and IMAP credentials. You can edit them or clear the server URL to discover settings automatically.'
              )}
            </p>
            <FormField
              field="settings.caldav_host"
              title={localized('Server URL')}
              {...this.props}
            />
            <FormField
              field="settings.caldav_username"
              title={localized('Username')}
              {...this.props}
            />
            <FormField
              field="settings.caldav_password"
              title={localized('Password')}
              type="password"
              {...this.props}
            />
          </div>
        </div>
      </div>
    );
  }
}

export default CreatePageForForm(AccountIMAPSettingsForm);
