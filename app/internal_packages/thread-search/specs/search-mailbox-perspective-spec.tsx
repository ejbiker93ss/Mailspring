import { MailboxPerspective } from 'mailspring-exports';

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
});
