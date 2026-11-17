import React from 'react';
import { localized, Utils, DOMUtils, Account, AccountStore, Actions } from 'summermail-exports';
import { OutlineView, ScrollRegion, Flexbox } from 'summermail-component-kit';
import AccountSwitcher from './account-switcher';
import SidebarStore from '../sidebar-store';
import { ISidebarSection } from '../types';

interface AccountSidebarState {
  accounts: Account[];
  sidebarAccountIds: string[];
  userSections: ISidebarSection[];
  standardSection: ISidebarSection;
}

export default class AccountSidebar extends React.Component<
  Record<string, unknown>,
  AccountSidebarState
> {
  static displayName = 'AccountSidebar';

  static containerRequired = false;
  static containerStyles = {
    minWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-min-width', 165),
    maxWidth: DOMUtils.getWorkspaceCssNumberProperty('account-sidebar-max-width', 250),
  };

  unsubscribers = [];

  constructor(props) {
    super(props);

    this.state = this._getStateFromStores();
  }

  componentDidMount() {
    this.unsubscribers.push(SidebarStore.listen(this._onStoreChange));
    return this.unsubscribers.push(AccountStore.listen(this._onStoreChange));
  }

  shouldComponentUpdate(nextProps: Record<string, unknown>, nextState: AccountSidebarState) {
    return !Utils.isEqualReact(nextProps, this.props) || !Utils.isEqualReact(nextState, this.state);
  }

  componentWillUnmount() {
    return this.unsubscribers.map((unsubscribe) => unsubscribe());
  }

  _onStoreChange = () => {
    return this.setState(this._getStateFromStores());
  };

  _getStateFromStores = () => {
    return {
      accounts: SidebarStore.accounts(),
      sidebarAccountIds: SidebarStore.sidebarAccountIds(),
      userSections: SidebarStore.userSections(),
      standardSection: SidebarStore.standardSection(),
    };
  };

  _renderUserSections(sections: ISidebarSection[]) {
    return sections.map((section) => <OutlineView key={section.title} {...section} />);
  }

  render() {
    const { accounts, sidebarAccountIds, userSections, standardSection } = this.state;

    return (
      <Flexbox direction="column" style={{ order: 0, flexShrink: 1, flex: 1 }}>
        <div className="account-sidebar-compose">
          <button
            type="button"
            className="account-sidebar-compose-button"
            onClick={() => Actions.composeNewBlankDraft()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span>{localized('New Message')}</span>
          </button>
        </div>
        <ScrollRegion className="account-sidebar" style={{ order: 2 }}>
          <AccountSwitcher accounts={accounts} sidebarAccountIds={sidebarAccountIds} />
          <nav className="account-sidebar-sections" aria-label={localized('Mailboxes')}>
            <OutlineView {...standardSection} />
            {this._renderUserSections(userSections)}
          </nav>
        </ScrollRegion>
      </Flexbox>
    );
  }
}
