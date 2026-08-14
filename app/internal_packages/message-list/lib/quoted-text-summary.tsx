import React from 'react';
import { AccountStore, Message, localized } from 'mailspring-exports';
import { AiSummaryMarkdown } from './ai-summary-markdown';
import { generateQuotedSummary } from './ai-summary-client';
import { getAiSummaryStore, AiSummaryScope } from './ai-summary-store';
import {
  MODEL_CONFIG_KEY,
  REDACT_PERSONAL_INFO_CONFIG_KEY,
  SUMMARY_INPUT_CAP_CONFIG_KEY,
  getMailAssistantAPIKey,
} from './preferences-mail-assistant';

interface Props {
  message: Message;
  quoteText: string;
}

interface State {
  available: boolean;
  cached: boolean;
  error: string;
  loading: boolean;
  open: boolean;
  summary: string | null;
}

function scopeFor(message: Message): AiSummaryScope | null {
  const account = AccountStore.accountForId(message.accountId);
  return account ? { username: account.id, mailbox: account.emailAddress } : null;
}

export default class QuotedTextSummary extends React.Component<Props, State> {
  static displayName = 'QuotedTextSummary';
  private _abort?: AbortController;

  state: State = {
    available: false,
    cached: false,
    error: '',
    loading: false,
    open: false,
    summary: null,
  };

  componentDidMount() {
    this._peek();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.quoteText !== this.props.quoteText) this._peek();
  }

  componentWillUnmount() {
    if (this._abort) this._abort.abort();
  }

  _peek = async () => {
    const scope = scopeFor(this.props.message);
    const apiKey = await getMailAssistantAPIKey();
    if (!scope || !apiKey) {
      this.setState({ available: false, summary: null, open: false });
      return;
    }
    const result = getAiSummaryStore().getQuotedSummary(scope, this.props.quoteText);
    this.setState({
      available: true,
      cached: !!result,
      error: '',
      open: !!result,
      summary: result ? result.summary : null,
    });
  };

  _generate = async (force = false) => {
    const scope = scopeFor(this.props.message);
    const apiKey = await getMailAssistantAPIKey();
    if (!scope || !apiKey) return;
    if (!force) {
      const cached = getAiSummaryStore().getQuotedSummary(scope, this.props.quoteText);
      if (cached) {
        this.setState({ cached: true, open: true, summary: cached.summary });
        return;
      }
    }
    this._abort = new AbortController();
    this.setState({ error: '', loading: true, open: true });
    try {
      const summary = await generateQuotedSummary({
        apiKey,
        model: AppEnv.config.get(MODEL_CONFIG_KEY) || 'gpt-5.6-terra',
        quoteText: this.props.quoteText,
        subject: this.props.message.subject,
        redactPersonalInfo: AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false,
        inputCap: AppEnv.config.get(SUMMARY_INPUT_CAP_CONFIG_KEY) || 120000,
        signal: this._abort.signal,
      });
      try {
        getAiSummaryStore().putQuotedSummary(scope, this.props.quoteText, summary);
      } catch (error) {
        AppEnv.reportError(error);
      }
      this.setState({ cached: false, loading: false, open: true, summary });
    } catch (error) {
      if (!this._abort.signal.aborted) {
        this.setState({ loading: false, error: error.message || String(error) });
      }
    }
  };

  render() {
    if (!this.state.available) return null;
    return (
      <div className="ai-quoted-summary">
        {!this.state.summary && (
          <button
            className="btn btn-toolbar"
            disabled={this.state.loading}
            onClick={() => this._generate()}
          >
            {this.state.loading
              ? localized('Summarizing...')
              : localized('Summarize quoted history')}
          </button>
        )}
        {this.state.summary && (
          <div className="ai-quoted-summary-card">
            <div className="ai-summary-heading">
              <span>
                {localized('AI summary')}
                {this.state.cached ? ` · ${localized('Saved for this quoted text')}` : ''}
              </span>
              <button
                className="btn btn-toolbar"
                onClick={() => this.setState({ open: !this.state.open })}
              >
                {this.state.open ? localized('Collapse') : localized('Expand')}
              </button>
            </div>
            {this.state.open && <AiSummaryMarkdown content={this.state.summary} />}
            {this.state.open && (
              <button
                className="btn btn-toolbar"
                disabled={this.state.loading}
                onClick={() => this._generate(true)}
              >
                {this.state.loading ? localized('Summarizing...') : localized('Regenerate')}
              </button>
            )}
          </div>
        )}
        {this.state.error && (
          <p className="ai-summary-error">
            {this.state.error}{' '}
            <button className="btn btn-toolbar" onClick={() => this._generate(true)}>
              {localized('Retry')}
            </button>
          </p>
        )}
      </div>
    );
  }
}
