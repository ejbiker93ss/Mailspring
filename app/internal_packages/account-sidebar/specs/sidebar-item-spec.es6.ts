import { Folder, Actions, CategoryStore } from 'mailspring-exports';
import SidebarItem, {
  configuredFavoriteFolders,
  FAVORITE_FOLDERS_CONFIG_KEY,
  reorderFavoriteFolders,
} from '../lib/sidebar-item';
import SidebarSection from '../lib/sidebar-section';

describe('sidebar-item', function sidebarItemSpec() {
  it('preserves nested labels on rename', () => {
    const queueTask = spyOn(Actions, 'queueTask');
    const categories = [new Folder({ path: 'a.b/c', accountId: TEST_ACCOUNT_ID })];
    AppEnv.savedState.sidebarKeysCollapsed = {};
    const item = SidebarItem.forCategories(categories) as any;
    item.onEdited(item, 'd');

    const task = queueTask.calls[0].args[0];
    const { existingPath, path } = task;
    expect(existingPath).toBe('a.b/c');
    expect(path).toBe('a.b/d');
  });
  it('preserves labels on rename', () => {
    const queueTask = spyOn(Actions, 'queueTask');
    const categories = [new Folder({ path: 'a', accountId: TEST_ACCOUNT_ID })];
    AppEnv.savedState.sidebarKeysCollapsed = {};
    const item = SidebarItem.forCategories(categories);
    item.onEdited(item, 'b') as any;

    const task = queueTask.calls[0].args[0];
    const { existingPath, path } = task;
    expect(existingPath).toBe('a');
    expect(path).toBe('b');
  });

  it('identifies favorites by both account and folder', () => {
    const favorites = [
      { accountId: 'account-a', folderId: 'Inbox' },
      { accountId: 'account-b', folderId: 'Inbox' },
    ];
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === FAVORITE_FOLDERS_CONFIG_KEY ? favorites : undefined
    );
    const setConfig = spyOn(AppEnv.config, 'set');
    AppEnv.savedState.sidebarKeysCollapsed = {};

    const accountAInbox = new Folder({ id: 'Inbox', path: 'Inbox', accountId: 'account-a' });
    const item = SidebarItem.forCategories([accountAInbox]);
    expect(item.favorite).toBe(true);
    item.onToggleFavorite(item);

    expect(configuredFavoriteFolders()).toEqual(favorites);
    expect(setConfig).toHaveBeenCalledWith(FAVORITE_FOLDERS_CONFIG_KEY, [
      { accountId: 'account-b', folderId: 'Inbox' },
    ]);
  });

  it('reorders favorites without losing their account identity', () => {
    const favorites = [
      { accountId: 'account-a', folderId: 'Inbox' },
      { accountId: 'account-b', folderId: 'Inbox' },
      { accountId: 'account-a', folderId: 'Work' },
    ];
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === FAVORITE_FOLDERS_CONFIG_KEY ? favorites : undefined
    );
    const setConfig = spyOn(AppEnv.config, 'set');

    reorderFavoriteFolders(favorites[2], favorites[0]);

    expect(setConfig).toHaveBeenCalledWith(FAVORITE_FOLDERS_CONFIG_KEY, [
      { accountId: 'account-a', folderId: 'Work' },
      { accountId: 'account-a', folderId: 'Inbox' },
      { accountId: 'account-b', folderId: 'Inbox' },
    ]);
  });

  it('only makes favorite rows draggable while reorder mode is active', () => {
    const account = { id: 'account-a', label: 'Account A' } as any;
    const inbox = new Folder({ id: 'Inbox', path: 'Inbox', accountId: account.id });
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === FAVORITE_FOLDERS_CONFIG_KEY
        ? [{ accountId: account.id, folderId: inbox.id }]
        : undefined
    );
    spyOn(CategoryStore, 'categories').andReturn([inbox]);
    AppEnv.savedState.sidebarKeysCollapsed = {};

    const normalItem = SidebarSection.favoritesSectionForAccounts([account], false).items[0];
    const reorderItem = SidebarSection.favoritesSectionForAccounts([account], true).items[0];

    expect(normalItem.draggable).toBe(false);
    expect(typeof normalItem.onToggleReorder).toBe('function');
    expect(reorderItem.draggable).toBe(true);
    expect(reorderItem.reordering).toBe(true);
  });
});
