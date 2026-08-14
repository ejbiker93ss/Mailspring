import React from 'react';
import { ipcRenderer, shell } from 'electron';
import { AccountStore, Actions, localized, WorkspaceStore } from 'mailspring-exports';

type IconName =
  | 'mail'
  | 'kanban'
  | 'calendar'
  | 'contacts'
  | 'tasks'
  | 'search'
  | 'admin'
  | 'settings';

const Icon = ({ name }: { name: IconName }) => {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      );
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
      );
    case 'kanban':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="10" rx="1" />
          <rect x="17" y="4" width="4" height="13" rx="1" />
        </svg>
      );
    case 'contacts':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'tasks':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2" />
          <path d="m8 12 2 2 5-5M8 6h8" />
        </svg>
      );
    case 'search':
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.37.7.6 1 .28.35.67.55 1.1.6h.09v4h-.09c-.43.05-.82.25-1.1.6-.23.3-.44.63-.6 1Z" />
        </svg>
      );
    default:
      return null;
  }
};

export const AppNavigationMenu = () => {
  const rootSheet = WorkspaceStore.rootSheet();

  const run = (callback: () => void) => {
    Actions.closePopover();
    callback();
  };

  const openMail = () => run(() => Actions.selectRootSheet(WorkspaceStore.Sheet.Threads));
  const openKanban = () => run(() => Actions.selectRootSheet(WorkspaceStore.Sheet.Kanban));
  const openCalendar = () => run(() => Actions.selectRootSheet(WorkspaceStore.Sheet.Calendar));
  const openContacts = () => run(() => ipcRenderer.send('command', 'application:show-contacts'));
  const openTasks = () =>
    run(() => {
      if (WorkspaceStore.Sheet.Activity) {
        Actions.selectRootSheet(WorkspaceStore.Sheet.Activity);
      }
    });
  const openSearch = () =>
    run(() => {
      Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
      window.setTimeout(() => AppEnv.commands.dispatch('core:focus-search'), 0);
    });
  const openAdmin = () =>
    run(() => {
      const account = AccountStore.accounts().find(
        (candidate) => candidate.provider === 'smartermail' && candidate.settings.smartermail_server
      );
      if (account) {
        shell.openExternal(account.settings.smartermail_server);
      } else {
        Actions.switchPreferencesTab('Accounts');
        Actions.openPreferences();
      }
    });
  const openSettings = () => run(() => Actions.openPreferences());

  const items: Array<{
    name: IconName;
    label: string;
    action: () => void;
    active?: boolean;
  }> = [
    {
      name: 'mail',
      label: localized('Mail'),
      action: openMail,
      active: rootSheet === WorkspaceStore.Sheet.Threads,
    },
    {
      name: 'kanban',
      label: localized('Kanban'),
      action: openKanban,
      active: rootSheet === WorkspaceStore.Sheet.Kanban,
    },
    {
      name: 'calendar',
      label: localized('Calendar'),
      action: openCalendar,
      active: rootSheet === WorkspaceStore.Sheet.Calendar,
    },
    { name: 'contacts', label: localized('Contacts'), action: openContacts },
    {
      name: 'tasks',
      label: localized('Tasks'),
      action: openTasks,
      active: rootSheet === WorkspaceStore.Sheet.Activity,
    },
    { name: 'search', label: localized('Search'), action: openSearch },
    { name: 'admin', label: localized('Admin'), action: openAdmin },
    { name: 'settings', label: localized('Settings'), action: openSettings },
  ];

  return (
    <div className="app-navigation-menu" role="menu" aria-label={localized('Applications')}>
      {items.map((item) => (
        <button
          key={item.name}
          type="button"
          role="menuitem"
          className={`app-navigation-menu-item${item.active ? ' active' : ''}`}
          onClick={item.action}
        >
          <Icon name={item.name} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
};

export default class AppNavigationButton extends React.Component {
  static displayName = 'AppNavigationButton';

  private buttonRef = React.createRef<HTMLButtonElement>();

  _onShowMenu = () => {
    const originRect = this.buttonRef.current.getBoundingClientRect();
    Actions.openPopover(<AppNavigationMenu />, { originRect, direction: 'down' });
  };

  render() {
    return (
      <button
        ref={this.buttonRef}
        type="button"
        className="btn btn-toolbar app-navigation-button"
        title={localized('Applications')}
        aria-label={localized('Applications')}
        aria-haspopup="menu"
        onClick={this._onShowMenu}
      >
        <Icon name="mail" />
        <span className="app-navigation-button-divider" />
        <svg
          className="app-navigation-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
    );
  }
}
