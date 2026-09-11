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

let configDisposable: { dispose(): void } | null = null;
let preferencesTab: any = null;

function syncSheetWithConfig() {
  const enabled = AppEnv.config.get('matrix-chat.enabled') === true;
  if (enabled && !WorkspaceStore.Sheet.Matrix) {
    WorkspaceStore.defineSheet('Matrix', { root: true, silent: true } as any, {
      list: ['MatrixRooms', 'MatrixConversation', 'MatrixPeople'],
    });
  } else if (!enabled && WorkspaceStore.Sheet.Matrix) {
    if (WorkspaceStore.rootSheet() === WorkspaceStore.Sheet.Matrix) {
      Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
    }
    WorkspaceStore.undefineSheet('Matrix');
  }
}

export function activate() {
  syncSheetWithConfig();
  configDisposable = AppEnv.config.onDidChange('matrix-chat.enabled', syncSheetWithConfig);
  ComponentRegistry.register(MatrixRoomList, { location: WorkspaceStore.Location.MatrixRooms });
  ComponentRegistry.register(MatrixConversation, {
    location: WorkspaceStore.Location.MatrixConversation,
  });
  ComponentRegistry.register(MatrixPeople, { location: WorkspaceStore.Location.MatrixPeople });
  void MatrixChatStore;

  preferencesTab = new PreferencesUIStore.TabItem({
    tabId: 'Matrix Chat',
    displayName: localized('Chat'),
    componentClassFn: () => require('./preferences-matrix-chat').default,
    order: 9,
  });
  PreferencesUIStore.registerPreferencesTab(preferencesTab);
}

export function deactivate() {
  ComponentRegistry.unregister(MatrixRoomList);
  ComponentRegistry.unregister(MatrixConversation);
  ComponentRegistry.unregister(MatrixPeople);
  configDisposable?.dispose();
  configDisposable = null;
  if (preferencesTab) {
    PreferencesUIStore.unregisterPreferencesTab(preferencesTab);
    preferencesTab = null;
  }
  WorkspaceStore.undefineSheet('Matrix');
}

export const config = {
  enabled: {
    type: 'boolean',
    default: false,
    title: localized('Enable Matrix Chat'),
  },
};
