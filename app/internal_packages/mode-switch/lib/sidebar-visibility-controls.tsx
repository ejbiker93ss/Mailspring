import React from 'react';
import { Actions, localized, WorkspaceStore } from 'mailspring-exports';

const CalendarIcon = () => (
  <span className="calendar-sidebar-toggle-icon" aria-hidden="true">
    <span />
  </span>
);

interface State {
  assistantHidden: boolean;
  calendarHidden: boolean;
}

export default class SidebarVisibilityControls extends React.Component<
  { compact?: boolean },
  State
> {
  private unsubscribe?: () => void;

  state = this.getState();

  componentDidMount() {
    this.unsubscribe = WorkspaceStore.listen(() => this.setState(this.getState()));
  }

  componentWillUnmount() {
    this.unsubscribe?.();
  }

  getState(): State {
    return {
      assistantHidden: WorkspaceStore.isLocationHidden(WorkspaceStore.Location.MessageListSidebar),
      calendarHidden: WorkspaceStore.isLocationHidden(WorkspaceStore.Location.CalendarSidebar),
    };
  }

  render() {
    return (
      <div
        className={`mail-sidebar-toggle-group ${this.props.compact ? 'compact' : ''}`}
        aria-label={localized('Sidebar visibility')}
      >
        <button
          type="button"
          className="sidebar-visibility-button ai-sidebar-toggle"
          title={this.state.assistantHidden ? localized('Show AI Chat') : localized('Hide AI Chat')}
          aria-label={
            this.state.assistantHidden ? localized('Show AI Chat') : localized('Hide AI Chat')
          }
          aria-pressed={!this.state.assistantHidden}
          onClick={() =>
            Actions.toggleWorkspaceLocationHidden(WorkspaceStore.Location.MessageListSidebar)
          }
        >
          <span className="mail-sidebar-ai-toggle-icon" aria-hidden="true">
            AI
          </span>
        </button>
        <button
          type="button"
          className="sidebar-visibility-button calendar-sidebar-toggle"
          title={
            this.state.calendarHidden
              ? localized('Show Calendar Sidebar')
              : localized('Hide Calendar Sidebar')
          }
          aria-label={
            this.state.calendarHidden
              ? localized('Show Calendar Sidebar')
              : localized('Hide Calendar Sidebar')
          }
          aria-pressed={!this.state.calendarHidden}
          onClick={() =>
            Actions.toggleWorkspaceLocationHidden(WorkspaceStore.Location.CalendarSidebar)
          }
        >
          <CalendarIcon />
        </button>
      </div>
    );
  }
}
