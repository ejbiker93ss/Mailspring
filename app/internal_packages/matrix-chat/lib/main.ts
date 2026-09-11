import {
  Actions,
  ComponentRegistry,
  localized,
  PreferencesUIStore,
  WorkspaceStore,
} from 'summermail-exports';
import MatrixChatStore from './matrix-chat-store';
import MatrixConversation from './matrix-conversation';
import MatrixRoomList from './matrix-room-list';
import MatrixPeople from './matrix-people';
import GroupMeChatStore from './groupme-store';
import GroupMeConversation from './groupme-conversation';
import GroupMeRoomList from './groupme-room-list';
import GroupMePeople from './groupme-people';

let configDisposable: { dispose(): void } | null = null;
let groupMeConfigDisposable: { dispose(): void } | null = null;
let preferencesTab: any = null;

const MATRIX_COLUMNS = {
  list: ['MatrixRooms', 'MatrixConversation', 'MatrixPeople'],
};

const GROUPME_COLUMNS = {
  list: ['GroupMeRooms', 'GroupMeConversation', 'GroupMePeople'],
};

function ensureLocations(id: 'Matrix' | 'GroupMe', columns: { [mode: string]: string[] }) {
  if (WorkspaceStore.Location[`${id}Rooms`]) return;

  // Components are registered when this package starts, while each chat tab can
  // be enabled later. Define and immediately remove a silent sheet so its
  // locations exist for ComponentRegistry without exposing an inactive tab.
  WorkspaceStore.defineSheet(id, { root: true, silent: true } as any, columns);
  WorkspaceStore.undefineSheet(id);
}

function syncSheetWithConfig() {
  const enabled = AppEnv.config.get('matrix-chat.enabled') === true;
  if (enabled && !WorkspaceStore.Sheet.Matrix) {
    WorkspaceStore.defineSheet('Matrix', { root: true, silent: true } as any, MATRIX_COLUMNS);
  } else if (!enabled && WorkspaceStore.Sheet.Matrix) {
    if (WorkspaceStore.rootSheet() === WorkspaceStore.Sheet.Matrix) {
      Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
    }
    WorkspaceStore.undefineSheet('Matrix');
  }

  const groupMeEnabled = AppEnv.config.get('groupme-chat.enabled') === true;
  if (groupMeEnabled && !WorkspaceStore.Sheet.GroupMe) {
    WorkspaceStore.defineSheet('GroupMe', { root: true, silent: true } as any, GROUPME_COLUMNS);
  } else if (!groupMeEnabled && WorkspaceStore.Sheet.GroupMe) {
    if (WorkspaceStore.rootSheet() === WorkspaceStore.Sheet.GroupMe) {
      Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
    }
    WorkspaceStore.undefineSheet('GroupMe');
  }
}

export function activate() {
  ensureLocations('Matrix', MATRIX_COLUMNS);
  ensureLocations('GroupMe', GROUPME_COLUMNS);
  syncSheetWithConfig();
  configDisposable = AppEnv.config.onDidChange('matrix-chat.enabled', syncSheetWithConfig);
  groupMeConfigDisposable = AppEnv.config.onDidChange('groupme-chat.enabled', syncSheetWithConfig);
  ComponentRegistry.register(MatrixRoomList, { location: WorkspaceStore.Location.MatrixRooms });
  ComponentRegistry.register(MatrixConversation, {
    location: WorkspaceStore.Location.MatrixConversation,
  });
  ComponentRegistry.register(MatrixPeople, { location: WorkspaceStore.Location.MatrixPeople });
  void MatrixChatStore;
  ComponentRegistry.register(GroupMeRoomList, { location: WorkspaceStore.Location.GroupMeRooms });
  ComponentRegistry.register(GroupMeConversation, {
    location: WorkspaceStore.Location.GroupMeConversation,
  });
  ComponentRegistry.register(GroupMePeople, { location: WorkspaceStore.Location.GroupMePeople });
  void GroupMeChatStore;

  preferencesTab = new PreferencesUIStore.TabItem({
    tabId: 'Matrix Chat',
    displayName: localized('Chat'),
    componentClassFn: () => require('./preferences-matrix-chat').default,
    order: 3,
  });
  PreferencesUIStore.registerPreferencesTab(preferencesTab);
}

export function deactivate() {
  ComponentRegistry.unregister(MatrixRoomList);
  ComponentRegistry.unregister(MatrixConversation);
  ComponentRegistry.unregister(MatrixPeople);
  ComponentRegistry.unregister(GroupMeRoomList);
  ComponentRegistry.unregister(GroupMeConversation);
  ComponentRegistry.unregister(GroupMePeople);
  configDisposable?.dispose();
  configDisposable = null;
  groupMeConfigDisposable?.dispose();
  groupMeConfigDisposable = null;
  if (preferencesTab) {
    PreferencesUIStore.unregisterPreferencesTab(preferencesTab);
    preferencesTab = null;
  }
  WorkspaceStore.undefineSheet('Matrix');
  WorkspaceStore.undefineSheet('GroupMe');
}

export const config = {
  enabled: {
    type: 'boolean',
    default: false,
    title: localized('Enable Matrix Chat'),
  },
};
