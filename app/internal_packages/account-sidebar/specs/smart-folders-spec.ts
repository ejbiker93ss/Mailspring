import {
  SMART_FOLDERS_CONFIG_KEY,
  SmartFolderDefinition,
  configuredSmartFolders,
  saveSmartFolder,
  smartFolderQuery,
  toggleSmartFolderFavorite,
} from '../lib/smart-folders';

const definition = (): SmartFolderDefinition => ({
  id: 'smart-folder-1',
  name: 'Invoices to review',
  scope: 'all',
  accountIds: [],
  match: 'all',
  favorite: false,
  criteria: [
    { id: 'subject', field: 'subject', value: 'invoice' },
    { id: 'body', field: 'body', value: 'amount due' },
    { id: 'state', field: 'state', value: 'unread' },
  ],
});

describe('smart folders', () => {
  it('builds an all-criteria search query with field-specific clauses', () => {
    expect(smartFolderQuery(definition())).toBe(
      'subject:"invoice" AND body:"amount due" AND is:unread'
    );
  });

  it('groups any-criterion searches so they compose as one expression', () => {
    const folder = definition();
    folder.match = 'any';

    expect(smartFolderQuery(folder)).toBe('(subject:"invoice" OR body:"amount due" OR is:unread)');
  });

  it('persists and favorites smart folders without losing their criteria', () => {
    let saved: SmartFolderDefinition[] = [];
    spyOn(AppEnv.config, 'get').andCallFake((key) =>
      key === SMART_FOLDERS_CONFIG_KEY ? saved : undefined
    );
    spyOn(AppEnv.config, 'set').andCallFake((_key, value) => {
      saved = value;
    });

    saveSmartFolder(definition());
    toggleSmartFolderFavorite('smart-folder-1');

    const folders = configuredSmartFolders();
    expect(folders.length).toBe(1);
    expect(folders[0].favorite).toBe(true);
    expect(folders[0].criteria[1]).toEqual({ id: 'body', field: 'body', value: 'amount due' });
  });
});
