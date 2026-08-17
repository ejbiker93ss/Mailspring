import { localized, AccountStore, Account, IdentityStore } from 'mailspring-exports';
import { ipcRenderer } from 'electron';
import MailspringStore from 'mailspring-store';

import * as OnboardingActions from './onboarding-actions';

class OnboardingStore extends MailspringStore {
  _account: Account;
  _pageStack: string[];

  constructor() {
    super();

    this.listenTo(OnboardingActions.moveToPreviousPage, this._onMoveToPreviousPage);
    this.listenTo(OnboardingActions.moveToPage, this._onMoveToPage);
    this.listenTo(OnboardingActions.setAccount, this._onSetAccount);
    this.listenTo(OnboardingActions.chooseAccountProvider, this._onChooseAccountProvider);
    this.listenTo(OnboardingActions.finishAndAddAccount, this._onFinishAndAddAccount);

    const { existingAccountJSON, addingAccount } = AppEnv.getWindowProps();

    const hasAccounts = AccountStore.accounts().length > 0;
    const identity = IdentityStore.identity();

    this._account = new Account({
      name: identity ? `${identity.firstName || ''} ${identity.lastName || ''}` : '',
      emailAddress: identity ? identity.emailAddress : '',
      settings: {},
    });

    if (existingAccountJSON) {
      // Used when re-adding an account after re-connecting, take the user back
      // to the best page with the most details
      this._account = new Account({}).fromJSON(existingAccountJSON);
      if (this._account.provider === 'gmail') {
        this._pageStack = ['account-choose', 'account-settings-gmail'];
      } else if (this._account.provider === 'office365') {
        this._pageStack = ['account-choose', 'account-settings-o365'];
      } else if (this._account.provider === 'outlook') {
        this._pageStack = ['account-choose', 'account-settings-outlook'];
      } else if (this._account.provider === 'smartermail') {
        this._pageStack = ['account-choose', 'account-settings-smartermail'];
      } else if (this._account.provider === 'imap') {
        this._pageStack = ['account-choose', 'account-settings', 'account-settings-imap'];
      } else {
        this._pageStack = ['account-choose', 'account-settings'];
      }
    } else if (addingAccount) {
      // Adding a new, unknown account
      this._pageStack = ['account-choose'];
    } else if (identity || hasAccounts) {
      // Account setup is local in this distribution. Existing profiles and
      // profiles upgraded without a legacy Mailspring ID go straight to the
      // provider picker instead of the hosted identity/subscription flow.
      this._pageStack = ['account-choose'];
    } else {
      // Standard new user onboarding flow.
      this._pageStack = ['welcome'];
    }
  }

  _onOnboardingComplete = () => {
    // When account JSON is received, we want to notify external services
    // that it succeeded. Unfortunately in this case we're likely to
    // close the window before those requests can be made. We add a short
    // delay here to ensure that any pending requests have a chance to
    // clear before the window closes.
    setTimeout(() => {
      ipcRenderer.send('account-setup-successful');
    }, 100);
  };

  _onChooseAccountProvider = (provider: string) => {
    const nextPage =
      provider === 'gmail'
        ? 'account-settings-gmail'
        : provider === 'office365'
          ? 'account-settings-o365'
          : provider === 'outlook'
            ? 'account-settings-outlook'
            : provider === 'smartermail'
              ? 'account-settings-smartermail'
              : 'account-settings';

    // Don't carry over any type-specific account information
    this._onSetAccount(
      new Account({
        emailAddress: this._account.emailAddress,
        name: this._account.name,
        settings: {},
        provider,
      })
    );

    this._onMoveToPage(nextPage);
  };

  _onSetAccount = (acct: Account) => {
    if (!(acct instanceof Account)) {
      throw new Error('OnboardingActions.setAccount expects an Account instance.');
    }
    this._account = acct;
    this.trigger();
  };

  _onMoveToPreviousPage = () => {
    if (this._pageStack.length <= 1) return;
    this._pageStack.pop();
    this.trigger();
  };

  _onMoveToPage = (page: string) => {
    this._pageStack.push(page);
    this.trigger();
  };

  _onFinishAndAddAccount = async (account: Account) => {
    const isFirstAccount = AccountStore.accounts().length === 0;

    try {
      await AccountStore.addAccount(account);
    } catch (e) {
      AppEnv.reportError(e);
      AppEnv.showErrorDialog({
        title: localized('Unable to Add Account'),
        message: localized(
          'Sorry, something went wrong when this account was added to Mailspring. If you do not see the account, try linking it again. %@',
          e.toString()
        ),
      });
    }

    AppEnv.displayWindow();

    if (isFirstAccount) {
      this._onMoveToPage('initial-preferences');
    } else {
      // let them see the "success" screen for a moment
      // before the window is closed.
      setTimeout(() => {
        this._onOnboardingComplete();
      }, 2000);
    }
  };

  page() {
    return this._pageStack[this._pageStack.length - 1];
  }

  pageDepth() {
    return this._pageStack.length;
  }

  account() {
    return this._account;
  }
}

export default new OnboardingStore();
