import { AccountStore, CategoryStore } from 'mailspring-exports';
import {
  createSettingsBundle,
  sanitizedSettings,
  settingsFromBundle,
} from '../lib/settings-transfer';

describe('settings transfer', () => {
  it('omits account data and secret-like values', () => {
    expect(
      sanitizedSettings({
        accounts: [{ id: 'account' }],
        credentials: { encrypted: 'value' },
        identity: { email: 'person@example.com' },
        core: { workspace: { mode: 'split' }, mcp: { token: 'secret', port: 2587 } },
        'mail-kanban': { lanesByAccount: { account: [] } },
      })
    ).toEqual({
      core: { workspace: { mode: 'split' }, mcp: { port: 2587 } },
      'mail-kanban': { lanesByAccount: { account: [] } },
    });
  });

  it('exports portable folder paths and remaps them during import', () => {
    const account = { id: 'local-id', emailAddress: 'person@example.com' } as any;
    const inbox = { id: 'inbox-id', path: 'Inbox', displayName: 'Inbox', role: 'inbox' } as any;
    const work = { id: 'work-id', path: 'Work', displayName: 'Work' } as any;
    spyOn(AccountStore, 'accounts').andReturn([account]);
    spyOn(CategoryStore, 'categories').andReturn([inbox, work]);

    const bundle = createSettingsBundle({
      core: {
        workspace: {
          favoriteFolders: [{ accountId: 'local-id', folderId: 'work-id' }],
          sidebarAccountOrder: ['local-id'],
          sidebarCollapsedAccountIds: ['local-id'],
          sidebarFolderOrderByAccount: { 'local-id': ['work-id', 'Unread'] },
        },
      },
      'mail-kanban': {
        lanesByAccount: { 'local-id': [{ id: 'old-lane', folderId: 'work-id' }] },
      },
    });
    expect(bundle.folderPreferences[0].favorites).toEqual(['Work']);
    expect(bundle.folderPreferences[0].kanban).toEqual(['Work']);
    expect(bundle.folderPreferences[0].order).toEqual([
      { type: 'folder', path: 'Work' },
      { type: 'item', id: 'Unread' },
    ]);
    expect(bundle.sidebarPreferences).toEqual({
      accountOrder: ['person@example.com'],
      collapsedAccounts: ['person@example.com'],
      favoriteOrder: [{ accountEmail: 'person@example.com', folderPath: 'Work' }],
    });

    const restored = settingsFromBundle(bundle, { core: { workspace: {} } });
    expect(restored.core.workspace.favoriteFolders).toEqual([
      { accountId: 'local-id', folderId: 'work-id' },
    ]);
    expect(restored.core.workspace.sidebarAccountOrder).toEqual(['local-id']);
    expect(restored.core.workspace.sidebarCollapsedAccountIds).toEqual(['local-id']);
    expect(restored.core.workspace.sidebarFolderOrderByAccount['local-id']).toEqual([
      'work-id',
      'Unread',
    ]);
    expect(restored['mail-kanban'].lanesByAccount['local-id'][0].folderId).toBe('work-id');
  });

  it('keeps identical folder identifiers distinct across mail accounts', () => {
    const accounts = [
      { id: 'account-a', emailAddress: 'a@example.com' },
      { id: 'account-b', emailAddress: 'b@example.com' },
    ] as any[];
    const folders = {
      'account-a': [
        { id: 'Inbox', accountId: 'account-a', path: 'Inbox', displayName: 'Inbox', role: 'inbox' },
      ],
      'account-b': [
        { id: 'Inbox', accountId: 'account-b', path: 'Inbox', displayName: 'Inbox', role: 'inbox' },
      ],
    };
    spyOn(AccountStore, 'accounts').andReturn(accounts);
    spyOn(CategoryStore, 'categories').andCallFake((accountId) => folders[accountId] || []);

    const bundle = createSettingsBundle({
      core: {
        workspace: {
          favoriteFolders: [
            { accountId: 'account-b', folderId: 'Inbox' },
            { accountId: 'account-a', folderId: 'Inbox' },
          ],
        },
      },
    });
    const restored = settingsFromBundle(bundle, { core: { workspace: {} } });

    expect(restored.core.workspace.favoriteFolders).toEqual([
      { accountId: 'account-b', folderId: 'Inbox' },
      { accountId: 'account-a', folderId: 'Inbox' },
    ]);
  });
});
