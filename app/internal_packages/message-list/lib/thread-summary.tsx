import React from 'react';
import { AccountStore, Message, Thread, localized } from 'mailspring-exports';
import { AiSummaryMarkdown } from './ai-summary-markdown';
import { generateThreadSummary } from './ai-summary-client';
import { getAiSummaryStore, AiSummaryScope, StoredThreadSummary } from './ai-summary-store';
import {
  MODEL_CONFIG_KEY,
  REDACT_PERSONAL_INFO_CONFIG_KEY,
  SUMMARY_INPUT_CAP_CONFIG_KEY,
  getMailAssistantAPIKey,
} from './preferences-mail-assistant';

interface Props {
  thread: Thread;
  messages: Message[];
}

interface State {
  error: string;
  hasAPIKey: boolean;
  loading: boolean;
  open: boolean;
  restored: boolean;
  result: StoredThreadSummary | null;
}

function scopeFor(messages: Message[]): AiSummaryScope | null {
  const accountId = messages[0] && messages[0].accountId;
  const account = accountId && AccountStore.accountForId(accountId);
  if (!account) return null;
  return { username: account.id, mailbox: account.emailAddress };
}

export default class ThreadSummary extends React.Component<Props, State> {
  static displayName = 'ThreadSummary';
  private _abort?: AbortController;
  private _mounted = false;

  state: State = {
    error: '',
    hasAPIKey: false,
    loading: false,
    open: true,
    restored: false,
    result: null,
  };

  componentDidMount() {
    this._mounted = true;
    this._restore();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.thread.id !== this.props.thread.id) this._restore();
  }

  componentWillUnmount() {
    this._mounted = false;
    if (this._abort) this._abort.abort();
  }

  _storageKey() {
    const scope = scopeFor(this.props.messages);
    return `smw:threadSummaryOpen:${scope ? scope.mailbox.toLowerCase() : 'unknown'}:${
      this.props.thread.id
    }`;
  }

  _restore = async () => {
    if (this._abort) this._abort.abort();
    const threadId = this.props.thread.id;
    const scope = scopeFor(this.props.messages);
    let result: StoredThreadSummary | null = null;
    if (scope) {
      try {
        result = getAiSummaryStore().getThreadSummary(scope, this.props.thread.id);
      } catch (error) {
        AppEnv.reportError(error);
      }
    }
    const savedOpen = localStorage.getItem(this._storageKey());
    const hasAPIKey = !!(await getMailAssistantAPIKey());
    if (!this._mounted || threadId !== this.props.thread.id) return;
    this.setState({
      error: '',
      hasAPIKey,
      loading: false,
      open: savedOpen === null ? true : savedOpen === 'true',
      restored: true,
      result,
    });
  };

  _setOpen = (open: boolean) => {
    localStorage.setItem(this._storageKey(), String(open));
    this.setState({ open });
  };

  _generate = async () => {
    const scope = scopeFor(this.props.messages);
    const apiKey = await getMailAssistantAPIKey();
    if (!scope || !apiKey) return;
    const messages = this.props.messages.filter((message) => !message.draft).slice(-60);
    this._abort = new AbortController();
    this.setState({ error: '', loading: true, open: true });
    try {
      const summary = await generateThreadSummary({
        apiKey,
        model: AppEnv.config.get(MODEL_CONFIG_KEY) || 'gpt-5.6-terra',
        messages,
        redactPersonalInfo: AppEnv.config.get(REDACT_PERSONAL_INFO_CONFIG_KEY) !== false,
        inputCap: AppEnv.config.get(SUMMARY_INPUT_CAP_CONFIG_KEY) || 120000,
        signal: this._abort.signal,
      });
      const updatedAt = new Date().toISOString();
      let result = { summary, messageCount: messages.length, updatedAt };
      try {
        result = getAiSummaryStore().putThreadSummary(
          scope,
          this.props.thread.id,
          this.props.thread.subject,
          summary,
          messages.length
        );
      } catch (error) {
        AppEnv.reportError(error);
      }
      if (this._mounted) {
        this._setOpen(true);
        this.setState({ loading: false, result });
      }
    } catch (error) {
      if (this._mounted && !this._abort.signal.aborted) {
        this.setState({ loading: false, error: error.message || String(error) });
      }
    }
  };

  render() {
    if (!this.state.restored) return null;
    const messageCount = this.props.messages.filter((message) => !message.draft).length;
    const stale = !!this.state.result && messageCount > this.state.result.messageCount;
    const actionLabel = this.state.result ? localized('Regenerate') : localized('Summarize');

    return (
      <section className="ai-thread-summary" aria-label={localized('AI thread summary')}>
        <div className="ai-summary-heading">
          <span>{localized('AI summary')}</span>
          {this.state.result && (
            <button className="btn btn-toolbar" onClick={() => this._setOpen(!this.state.open)}>
              {this.state.open ? localized('Collapse') : localized('Expand')}
            </button>
          )}
        </div>
        {this.state.result && this.state.open && (
          <AiSummaryMarkdown content={this.state.result.summary} />
        )}
        {stale && this.state.open && (
          <p className="ai-summary-stale">{localized('New messages since the last summary.')}</p>
        )}
        {this.state.error && <p className="ai-summary-error">{this.state.error}</p>}
        <button
          className="btn ai-summary-action"
          disabled={this.state.loading || !this.state.hasAPIKey}
          title={
            this.state.hasAPIKey
              ? ''
              : localized('Add your OpenAI API key in AI Assistant settings to summarize mail.')
          }
          onClick={this._generate}
        >
          {this.state.loading ? localized('Summarizing...') : actionLabel}
        </button>
      </section>
    );
  }
}
