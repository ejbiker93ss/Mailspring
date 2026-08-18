import React from 'react';
import { KeyManager, localized } from 'mailspring-exports';
import {
  connectMicrosoftTeams,
  disconnectMicrosoftTeams,
  getMicrosoftTeamsConnection,
  MicrosoftTeamsConnection,
} from '../../main-calendar/lib/core/microsoft-teams-connection';

const API_KEY_NAME = 'openai-mail-assistant-api-key';
const MANAGED_API_KEY_ENV_NAMES = ['MSSE_OPENAI_API_KEY', 'OPENAI_API_KEY'];
export const MODEL_CONFIG_KEY = 'core.mailAssistant.model';
export const INCLUDE_TEXT_CONFIG_KEY = 'core.mailAssistant.includeRedactedText';
export const REDACT_PERSONAL_INFO_CONFIG_KEY = 'core.mailAssistant.redactPersonalInfo';
export const USE_THREAD_CONFIG_KEY = 'core.mailAssistant.useCurrentThread';
export const THREAD_SUMMARIES_CONFIG_KEY = 'core.mailAssistant.threadSummariesEnabled';
export const QUOTED_SUMMARIES_CONFIG_KEY = 'core.mailAssistant.quotedTextSummariesEnabled';
export const SUMMARY_INPUT_CAP_CONFIG_KEY = 'core.mailAssistant.summaryInputCap';

interface State {
  apiKey: string;
  hasManagedKey: boolean;
  hasSavedKey: boolean;
  includeRedactedText: boolean;
  model: string;
  redactPersonalInfo: boolean;
  saving: boolean;
  status: string;
  teamsConnection: MicrosoftTeamsConnection | null;
  teamsConnecting: boolean;
  teamsStatus: string;
  threadSummariesEnabled: boolean;
  quotedTextSummariesEnabled: boolean;
  useCurrentThread: boolean;
}

export function getManagedMailAssistantAPIKey() {
  for (const name of MANAGED_API_KEY_ENV_NAMES) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

export async function getMailAssistantAPIKey() {
  return getManagedMailAssistantAPIKey() || KeyManager.getPassword(API_KEY_NAME);
}

export default class PreferencesMailAssistant extends React.Component<
  Record<string, never>,
  State
> {
  static displayName = 'PreferencesMailAssistant';

  state: State = {
    apiKey: '',
    hasManagedKey: false,
    hasSavedKey: false,
    includeRedactedText: AppEnv.config.get(INCLUDE_TEXT_CONFIG_KEY) !== false,
    model: AppEnv.config.get(MODEL_CONFIG_KEY) || 'gpt-5.6-terra',
    redactPersonalInfo: AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false,
    saving: false,
    status: '',
    teamsConnection: getMicrosoftTeamsConnection(),
    teamsConnecting: false,
    teamsStatus: '',
    threadSummariesEnabled: AppEnv.config.get(THREAD_SUMMARIES_CONFIG_KEY) !== false,
    quotedTextSummariesEnabled: AppEnv.config.get(QUOTED_SUMMARIES_CONFIG_KEY) !== false,
    useCurrentThread: AppEnv.config.get(USE_THREAD_CONFIG_KEY) !== false,
  };

  async componentDidMount() {
    const hasManagedKey = !!getManagedMailAssistantAPIKey();
    this.setState({
      hasManagedKey,
      hasSavedKey: hasManagedKey ? false : !!(await KeyManager.getPassword(API_KEY_NAME)),
    });
  }

  _save = async () => {
    this.setState({ saving: true, status: '' });
    try {
      if (!this.state.hasManagedKey && this.state.apiKey.trim()) {
        await KeyManager.replacePassword(API_KEY_NAME, this.state.apiKey.trim());
      }
      AppEnv.config.set(MODEL_CONFIG_KEY, this.state.model.trim() || 'gpt-5.6-terra');
      AppEnv.config.set(INCLUDE_TEXT_CONFIG_KEY, this.state.includeRedactedText);
      AppEnv.config.set(REDACT_PERSONAL_INFO_CONFIG_KEY, this.state.redactPersonalInfo);
      AppEnv.config.set(USE_THREAD_CONFIG_KEY, this.state.useCurrentThread);
      AppEnv.config.set(THREAD_SUMMARIES_CONFIG_KEY, this.state.threadSummariesEnabled);
      AppEnv.config.set(QUOTED_SUMMARIES_CONFIG_KEY, this.state.quotedTextSummariesEnabled);
      this.setState({
        apiKey: '',
        hasSavedKey:
          !this.state.hasManagedKey && (this.state.hasSavedKey || !!this.state.apiKey.trim()),
        saving: false,
        status: localized('Saved securely.'),
      });
    } catch (error) {
      this.setState({ saving: false, status: error.message || String(error) });
    }
  };

  _clearKey = async () => {
    await KeyManager.deletePassword(API_KEY_NAME);
    this.setState({ apiKey: '', hasSavedKey: false, status: localized('API key removed.') });
  };

  _connectTeams = async () => {
    this.setState({ teamsConnecting: true, teamsStatus: localized('Waiting for Microsoft…') });
    try {
      const teamsConnection = await connectMicrosoftTeams();
      this.setState({
        teamsConnection,
        teamsConnecting: false,
        teamsStatus: localized('Microsoft Teams connected.'),
      });
    } catch (error) {
      this.setState({
        teamsConnecting: false,
        teamsStatus: error.message || String(error),
      });
    }
  };

  _disconnectTeams = async () => {
    await disconnectMicrosoftTeams();
    this.setState({
      teamsConnection: null,
      teamsStatus: localized('Microsoft Teams disconnected.'),
    });
  };

  render() {
    return (
      <div className="preferences-mail-assistant">
        <section>
          <h2>{localized('AI Mail Assistant')}</h2>
          <p>
            {this.state.hasManagedKey
              ? localized(
                  'Your organization provides the OpenAI API credential through the Windows environment. Mailspring does not save it.'
                )
              : localized(
                  'Your API key is encrypted using the same operating-system credential storage as your mail passwords.'
                )}
          </p>
          {this.state.hasManagedKey ? (
            <p className="mail-assistant-managed-key-status">
              {localized('Managed company credential detected.')}
            </p>
          ) : (
            <>
              <label htmlFor="mail-assistant-api-key">{localized('OpenAI API key')}</label>
              <input
                id="mail-assistant-api-key"
                type="password"
                autoComplete="off"
                value={this.state.apiKey}
                placeholder={this.state.hasSavedKey ? '•••••••••••••••• saved' : 'sk-…'}
                onChange={(event) => this.setState({ apiKey: event.target.value, status: '' })}
              />
            </>
          )}
        </section>
        <section>
          <label htmlFor="mail-assistant-model">{localized('Model')}</label>
          <input
            id="mail-assistant-model"
            type="text"
            value={this.state.model}
            onChange={(event) => this.setState({ model: event.target.value, status: '' })}
          />
          <label className="mail-assistant-checkbox">
            <input
              type="checkbox"
              checked={this.state.threadSummariesEnabled}
              onChange={(event) =>
                this.setState({ threadSummariesEnabled: event.target.checked, status: '' })
              }
            />
            {localized('Show AI summaries for email threads')}
          </label>
          <label className="mail-assistant-checkbox">
            <input
              type="checkbox"
              checked={this.state.quotedTextSummariesEnabled}
              onChange={(event) =>
                this.setState({ quotedTextSummariesEnabled: event.target.checked, status: '' })
              }
            />
            {localized('Show AI summaries for quoted email history')}
          </label>
          <label className="mail-assistant-checkbox">
            <input
              type="checkbox"
              checked={this.state.useCurrentThread}
              onChange={(event) =>
                this.setState({ useCurrentThread: event.target.checked, status: '' })
              }
            />
            {localized('Use the current email thread as AI chat context')}
          </label>
          <label className="mail-assistant-checkbox">
            <input
              type="checkbox"
              checked={this.state.includeRedactedText}
              disabled={!this.state.useCurrentThread}
              onChange={(event) =>
                this.setState({ includeRedactedText: event.target.checked, status: '' })
              }
            />
            {localized('Include message text when current-thread context is enabled')}
          </label>
          <label className="mail-assistant-checkbox mail-assistant-privacy-toggle">
            <input
              type="checkbox"
              checked={this.state.redactPersonalInfo}
              onChange={(event) =>
                this.setState({ redactPersonalInfo: event.target.checked, status: '' })
              }
            />
            <span>
              <strong>{localized('Remove personal information before sending mail to AI')}</strong>
              <small>
                {localized(
                  'Replaces names, email addresses, phone numbers, and URLs locally in current-thread and mailbox-wide results.'
                )}
              </small>
            </span>
          </label>
          {!this.state.redactPersonalInfo && (
            <p className="mail-assistant-privacy-warning">
              {localized(
                'Privacy filtering is off. Original names, addresses, phone numbers, URLs, and matching message content may be sent to OpenAI. This can improve recipient-aware answers and actions.'
              )}
            </p>
          )}
          <p className="mail-assistant-privacy-note">
            {localized(
              'The message-text option above controls detail: turn it off to send current-thread metadata only.'
            )}
          </p>
          <p className="mail-assistant-privacy-note">
            {localized(
              'Mailbox-wide questions use the read-only tools and account/folder permissions configured under MCP Server. Matching mail content is sent to OpenAI to answer your question.'
            )}
          </p>
        </section>
        <section className="mail-assistant-teams-connection">
          <h2>{localized('Microsoft Teams meetings')}</h2>
          <p>
            {localized(
              'Connect Microsoft through Graph to create Teams links and phone dial-in details. This connection does not use IMAP or SMTP and does not add the Microsoft mailbox to Mailspring.'
            )}
          </p>
          {this.state.teamsConnection ? (
            <div className="mail-assistant-connection-row">
              <div>
                <strong>{this.state.teamsConnection.name}</strong>
                <small>{this.state.teamsConnection.emailAddress}</small>
              </div>
              <button className="btn" onClick={this._disconnectTeams}>
                {localized('Disconnect')}
              </button>
            </div>
          ) : (
            <button
              className="btn btn-emphasis"
              disabled={this.state.teamsConnecting}
              onClick={this._connectTeams}
            >
              {this.state.teamsConnecting
                ? localized('Connecting…')
                : localized('Connect Microsoft Teams')}
            </button>
          )}
          {this.state.teamsStatus && (
            <p className="mail-assistant-connection-status">{this.state.teamsStatus}</p>
          )}
        </section>
        <div className="mail-assistant-settings-actions">
          <button className="btn btn-emphasis" disabled={this.state.saving} onClick={this._save}>
            {this.state.saving ? localized('Saving…') : localized('Save')}
          </button>
          {!this.state.hasManagedKey && this.state.hasSavedKey && (
            <button className="btn" disabled={this.state.saving} onClick={this._clearKey}>
              {localized('Remove API key')}
            </button>
          )}
          <span>{this.state.status}</span>
        </div>
      </div>
    );
  }
}
