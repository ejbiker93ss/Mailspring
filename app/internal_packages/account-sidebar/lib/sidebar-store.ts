import _ from 'underscore';
import MailspringStore from 'mailspring-store';
import {
  Actions,
  Account,
  AccountStore,
  ThreadCountsStore,
  WorkspaceStore,
  OutboxStore,
  FocusedPerspectiveStore,
  CategoryStore,
  localized,
} from 'mailspring-exports';

import SidebarSection from './sidebar-section';
import * as SidebarActions from './sidebar-actions';
import * as AccountCommands from './account-commands';
import { Disposable } from 'event-kit';
import { ISidebarSection } from './types';
import { FAVORITE_FOLDERS_CONFIG_KEY } from './sidebar-item';
import {
  SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY,
  SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY,
  SIDEBAR_FOLDER_ORDER_CONFIG_KEY,
  SIDEBAR_REORDER_DRAG_TYPE,
  reorderAccounts,
  sortedAccounts,
} from './sidebar-preferences';

const Sections = {
  Standard: 'Standard',
  User: 'User',
};

class SidebarStore extends MailspringStore {
  _sections: {
    Standard: ISidebarSection;
    User: ISidebarSection[];
  } = {
    Standard: { title: '', items: [] },
    User: [],
  };
  configSubscription: Disposable;

  constructor() {
    super();

    if (AppEnv.savedState.sidebarKeysCollapsed == null) {
      AppEnv.savedState.sidebarKeysCollapsed = {};
    }
    this._registerCommands();
    this._registerMenuItems();
    this._registerListeners();
    this._updateSections();
  }

  accounts() {
    return sortedAccounts(AccountStore.accounts());
  }

  sidebarAccountIds() {
    return FocusedPerspectiveStore.sidebarAccountIds();
  }

  standardSection() {
    return this._sections.Standard;
  }

  userSections() {
    return this._sections.User;
  }

  _registerListeners() {
    this.listenTo(Actions.setCollapsedSidebarItem, this._onSetCollapsedByName);
    this.listenTo(SidebarActions.setKeyCollapsed, this._onSetCollapsedByKey);
    this.listenTo(AccountStore, this._onAccountsChanged);
    this.listenTo(FocusedPerspectiveStore, this._onFocusedPerspectiveChanged);
    this.listenTo(WorkspaceStore, this._updateSections);
    this.listenTo(OutboxStore, this._updateSections);
    this.listenTo(ThreadCountsStore, this._updateSections);
    this.listenTo(CategoryStore, this._updateSections);

    this.configSubscription = AppEnv.config.onDidChange(
      'core.workspace.showUnreadForAllCategories',
      this._updateSections
    );
    AppEnv.config.onDidChange('core.workspace.sidebarOrganization', this._updateSections);
    AppEnv.config.onDidChange(FAVORITE_FOLDERS_CONFIG_KEY, this._updateSections);
    AppEnv.config.onDidChange(SIDEBAR_ACCOUNT_ORDER_CONFIG_KEY, this._updateSections);
    AppEnv.config.onDidChange(SIDEBAR_FOLDER_ORDER_CONFIG_KEY, this._updateSections);
    AppEnv.config.onDidChange(SIDEBAR_COLLAPSED_ACCOUNTS_CONFIG_KEY, this._updateSections);
  }

  _onSetCollapsedByKey = (itemKey: string, collapsed: boolean) => {
    const currentValue = AppEnv.savedState.sidebarKeysCollapsed[itemKey];
    if (currentValue !== collapsed) {
      AppEnv.savedState.sidebarKeysCollapsed[itemKey] = collapsed;
      this._updateSections();
    }
  };

  _onSetCollapsedByName = (itemName: string, collapsed: boolean) => {
    let item = this.standardSection().items.find((i) => i.name === itemName);
    if (!item) {
      for (const section of this.userSections()) {
        item = section.items.find((x) => x.name === itemName);
        if (item) {
          break;
        }
      }
    }
    if (!item) {
      return;
    }
    this._onSetCollapsedByKey(item.id, collapsed);
  };

  _registerCommands = (accounts: Account[] = null) => {
    if (accounts == null) {
      accounts = AccountStore.accounts();
    }
    AccountCommands.registerCommands(accounts);
  };

  _registerMenuItems = (accounts: Account[] = null) => {
    if (accounts == null) {
      accounts = AccountStore.accounts();
    }
    AccountCommands.registerMenuItems(accounts, FocusedPerspectiveStore.sidebarAccountIds());
  };

  // TODO Refactor this
  // Listen to changes on the account store only for when the account label
  // or order changes. When accounts or added or removed, those changes will
  // come in through the FocusedPerspectiveStore
  _onAccountsChanged = () => {
    this._updateSections();
  };

  // TODO Refactor this
  // The FocusedPerspectiveStore tells this store the accounts that should be
  // displayed in the sidebar (i.e. unified inbox vs single account) and will
  // trigger whenever an account is added or removed, as well as when a
  // perspective is focused.
  // However, when udpating the SidebarSections, we also depend on the actual
  // accounts in the AccountStore. The problem is that the FocusedPerspectiveStore
  // triggers before the AccountStore is actually updated, so we need to wait for
  // the AccountStore to get updated (via `defer`) before updateing our sidebar
  // sections
  _onFocusedPerspectiveChanged = () => {
    _.defer(() => {
      this._registerCommands();
      this._registerMenuItems();
      this._updateSections();
    });
  };

  _updateSections = () => {
    const accounts = sortedAccounts(
      FocusedPerspectiveStore.sidebarAccountIds()
        .map((id) => AccountStore.accountForId(id))
        .filter((a) => !!a)
    );

    if (accounts.length === 0) {
      return;
    }
    const multiAccount = accounts.length > 1;
    const organization = AppEnv.config.get('core.workspace.sidebarOrganization') || 'folders';

    this._sections[Sections.Standard] = SidebarSection.favoritesSectionForAccounts(accounts);

    if (organization === 'accounts') {
      this._sections[Sections.User] = accounts.map((account) => {
        const section = SidebarSection.completeSectionForAccount(account);
        return this._makeAccountSectionReorderable(section, account, accounts);
      });
    } else {
      const groupedFolders = SidebarSection.standardSectionForAccounts(accounts);
      groupedFolders.title = localized('Mailboxes');
      groupedFolders.iconName = 'folder.png';

      const customFolders = accounts.map((acc) => {
        const opts: { title?: string; collapsible?: boolean; accountSection?: boolean } = {};
        if (multiAccount) {
          opts.title = acc.label;
          opts.collapsible = true;
          opts.accountSection = true;
        }
        const section = SidebarSection.forUserCategories(acc, opts);
        return multiAccount ? this._makeAccountSectionReorderable(section, acc, accounts) : section;
      });
      this._sections[Sections.User] = [groupedFolders, ...customFolders];
    }
    this.trigger();
  };

  _makeAccountSectionReorderable = (
    section: ISidebarSection,
    account: Account,
    accounts: Account[]
  ): ISidebarSection => ({
    ...section,
    accountId: account.id,
    reorderable: accounts.length > 1,
    onSectionDragStart(event) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(
        SIDEBAR_REORDER_DRAG_TYPE,
        JSON.stringify({ kind: 'account', accountId: account.id })
      );
    },
    shouldAcceptSectionDrop(event) {
      if (!event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) return true;
      try {
        const payload = JSON.parse(event.dataTransfer.getData(SIDEBAR_REORDER_DRAG_TYPE));
        return payload.kind === 'account' && payload.accountId !== account.id;
      } catch (_err) {
        return false;
      }
    },
    onSectionDrop(event) {
      if (!event.dataTransfer.types.includes(SIDEBAR_REORDER_DRAG_TYPE)) return;
      try {
        const payload = JSON.parse(event.dataTransfer.getData(SIDEBAR_REORDER_DRAG_TYPE));
        if (payload.kind === 'account') {
          const bounds = event.currentTarget.getBoundingClientRect();
          reorderAccounts(
            payload.accountId,
            account.id,
            accounts,
            event.clientY > bounds.top + bounds.height / 2
          );
        }
      } catch (_err) {
        // Ignore malformed drag data from outside FlashMail.
      }
    },
  });
}

export default new SidebarStore();
