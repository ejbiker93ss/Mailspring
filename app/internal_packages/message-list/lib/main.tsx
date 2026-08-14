import {
  MailboxPerspective,
  ComponentRegistry,
  WorkspaceStore,
  DatabaseStore,
  Actions,
  Thread,
  ExtensionRegistry,
  PreferencesUIStore,
  localized,
} from 'mailspring-exports';

import { MessageListHiddenMessagesToggle } from './message-list-hidden-messages-toggle';
import MessageList from './message-list';
import UnthreadedMessageList from './unthreaded-message-list';
import MessageOwnerStatus from './message-owner-status';
import StickyThreadHeader from './sticky-thread-header';
import LongDashQuotedReplyExtension from './extensions/long-dash-quoted-reply-extension';

export function activate() {
  UnthreadedMessageList.CoreComponent = MessageList;
  ExtensionRegistry.MessageView.register(LongDashQuotedReplyExtension);
  ComponentRegistry.register(MessageOwnerStatus, { role: 'MessageHeaderStatus' });
  ComponentRegistry.register(StickyThreadHeader, { role: 'MessageListHeaders' });
  this.preferencesTab = new PreferencesUIStore.TabItem({
    tabId: 'AI Assistant',
    displayName: localized('AI Assistant'),
    componentClassFn: () => require('./preferences-mail-assistant').default,
  });
  PreferencesUIStore.registerPreferencesTab(this.preferencesTab);

  if (AppEnv.isMainWindow()) {
    // Register Message List Actions we provide globally
    ComponentRegistry.register(UnthreadedMessageList, {
      location: WorkspaceStore.Location.MessageList,
    });
    ComponentRegistry.register(MessageListHiddenMessagesToggle, {
      role: 'MessageListHeaders',
    });
  } else {
    // This is for the thread-popout window.
    const { threadId, perspectiveJSON } = AppEnv.getWindowProps();
    ComponentRegistry.register(UnthreadedMessageList, {
      location: WorkspaceStore.Location.Center,
    });

    // We need to locate the thread and focus it so that the MessageList displays it
    DatabaseStore.find<Thread>(Thread, threadId).then((thread) =>
      Actions.setFocus({ collection: 'thread', item: thread })
    );

    // Set the focused perspective and hide the proper messages
    // (e.g. we should hide deleted items from the inbox, but not from trash)
    Actions.focusMailboxPerspective(MailboxPerspective.fromJSON(perspectiveJSON));
    ComponentRegistry.register(MessageListHiddenMessagesToggle, {
      role: 'MessageListHeaders',
    });
  }
}

export function deactivate() {
  ExtensionRegistry.MessageView.unregister(LongDashQuotedReplyExtension);
  ComponentRegistry.unregister(UnthreadedMessageList);
  ComponentRegistry.unregister(MessageOwnerStatus);
  ComponentRegistry.unregister(StickyThreadHeader);
  PreferencesUIStore.unregisterPreferencesTab(this.preferencesTab.tabId);
}
