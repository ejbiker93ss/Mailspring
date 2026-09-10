import { MailboxPerspective } from 'summermail-exports';

import SearchMailboxPerspective from '../lib/search-mailbox-perspective';

describe('SearchMailboxPerspective', function () {
  it('searches all messages without implicitly excluding trash or spam', function () {
    const source = new MailboxPerspective(['account-1']);
    const perspective = new SearchMailboxPerspective(source, '  chino  ');
    const subscription = perspective.threads() as any;

    expect(subscription._searchQuery).toBe('chino');
  });

  it('preserves explicit folder filters', function () {
    const source = new MailboxPerspective(['account-1']);
    const perspective = new SearchMailboxPerspective(source, 'chino in:trash');
    const subscription = perspective.threads() as any;

    expect(subscription._searchQuery).toBe('chino in:trash');
  });

  it('serializes named smart-folder searches for session restoration', function () {
    const source = new MailboxPerspective(['account-1', 'account-2']);
    const perspective = new SearchMailboxPerspective(source, 'body:"amount due"', {
      name: 'Invoices',
      smartFolderId: 'smart-folder-1',
    });

    const restored = MailboxPerspective.fromJSON(perspective.toJSON()) as any;

    expect(restored.name).toBe('Invoices');
    expect(restored.smartFolderId).toBe('smart-folder-1');
    expect(restored.accountIds).toEqual(['account-1', 'account-2']);
    expect(restored.searchQuery).toBe('body:"amount due"');
  });
});
