import React from 'react';
import { MailActionIcon } from '../../../src/components/mail-action-icon';
import { localized } from 'summermail-exports';

const EMAIL_RENDER_MODE_KEY = 'core.reading.emailRenderMode';

interface SubjectLineIconsProps {
  canCollapse: boolean;
  hasCollapsedItems: boolean;
  showAiSummaryControl: boolean;
  threadId: string;

  onPrint: () => void;
  onPopIn: () => void;
  onPopOut: () => void;
  onToggleAllExpanded: () => void;
}

class EmailRenderModeToggle extends React.Component<Record<string, never>, { mode: string }> {
  _configDisposable?: { dispose: () => void };

  constructor(props: Record<string, never>) {
    super(props);
    this.state = { mode: this._mode() };
  }

  componentDidMount() {
    this._configDisposable = AppEnv.config.onDidChange(EMAIL_RENDER_MODE_KEY, () => {
      this.setState({ mode: this._mode() });
    });
  }

  componentWillUnmount() {
    if (this._configDisposable) {
      this._configDisposable.dispose();
    }
  }

  _mode = () => (AppEnv.config.get(EMAIL_RENDER_MODE_KEY) === 'dark' ? 'dark' : 'light');

  _isDark = () => this.state.mode === 'dark';

  _onToggle = () => {
    const nextMode = this._isDark() ? 'light' : 'dark';
    AppEnv.config.set(EMAIL_RENDER_MODE_KEY, nextMode);
  };

  render() {
    const isDark = this._isDark();
    const title = isDark
      ? localized('Switch email view to light mode')
      : localized('Switch email view to dark mode');

    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={title}
        title={title}
        onClick={this._onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this._onToggle();
          }
        }}
      >
        <MailActionIcon name={isDark ? 'sun' : 'moon'} />
      </div>
    );
  }
}

export const SubjectLineIcons: React.FunctionComponent<SubjectLineIconsProps> = (props) => (
  <div className="message-icons-wrap">
    {props.showAiSummaryControl && (
      <span className="ai-summary-toolbar-target" data-thread-id={props.threadId} />
    )}
    {props.canCollapse && (
      <div
        role="button"
        tabIndex={0}
        aria-label={props.hasCollapsedItems ? localized('Expand All') : localized('Collapse All')}
        title={props.hasCollapsedItems ? localized('Expand All') : localized('Collapse All')}
        onClick={props.onToggleAllExpanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onToggleAllExpanded();
          }
        }}
      >
        <MailActionIcon name={props.hasCollapsedItems ? 'expand' : 'collapse'} />
      </div>
    )}
    <div
      role="button"
      tabIndex={0}
      aria-label={localized('Print Thread')}
      title={localized('Print Thread')}
      onClick={props.onPrint}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          props.onPrint();
        }
      }}
    >
      <MailActionIcon name="print" />
    </div>
    <EmailRenderModeToggle />
    {AppEnv.isThreadWindow() ? (
      <div
        role="button"
        tabIndex={0}
        aria-label={localized('Pop thread in')}
        title={localized('Pop thread in')}
        onClick={props.onPopIn}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onPopIn();
          }
        }}
      >
        <MailActionIcon name="pop-in" />
      </div>
    ) : (
      <div
        role="button"
        tabIndex={0}
        aria-label={localized('Popout thread')}
        title={localized('Popout thread')}
        onClick={props.onPopOut}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onPopOut();
          }
        }}
      >
        <MailActionIcon name="pop-out" />
      </div>
    )}
  </div>
);
