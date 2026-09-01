import React from 'react';
import {
  localized,
  Folder,
  Label,
  ChangeLabelsTask,
  ChangeFolderTask,
  AccountStore,
  CategoryStore,
  TaskFactory,
  MailboxPerspective,
} from 'mailspring-exports';
import SearchQuerySubscription from './search-query-subscription';

class SearchMailboxPerspective extends MailboxPerspective {
  searchQuery: string;
  sourcePerspective: MailboxPerspective;
  name: string;

  constructor(sourcePerspective, searchQuery: string) {
    super(sourcePerspective.accountIds);
    if (typeof searchQuery !== 'string') {
      throw new Error('SearchMailboxPerspective: Expected a `string` search query');
    }

    this.searchQuery = searchQuery;

    if (sourcePerspective instanceof SearchMailboxPerspective) {
      this.sourcePerspective = sourcePerspective.sourcePerspective;
    } else {
      this.sourcePerspective = sourcePerspective;
    }

    this.name = `Searching ${this.sourcePerspective.name}`;
  }

  emptyMessage() {
    return <span>{localized('No search results')}</span>;
  }

  isEqual(other) {
    return super.isEqual(other) && other.searchQuery === this.searchQuery;
  }

  threads() {
    // Search exactly what the user entered. Applying an implicit thread-level Trash / Spam
    // exclusion can hide valid Inbox messages when any other message in the conversation
    // is deleted or marked as spam.
    return new SearchQuerySubscription(this.searchQuery.trim(), this.accountIds);
  }

  canReceiveThreadsFromAccountIds() {
    return false;
  }

  tasksForRemovingItems(threads, source?: string) {
    return TaskFactory.tasksForThreadsByAccountId(threads, (accountThreads, accountId) => {
      const account = AccountStore.accountForId(accountId);
      if (!account) {
        return [];
      }
      const dest = account.preferredRemovalDestination();
      if (!dest) {
        return [];
      }
      if (dest instanceof Folder) {
        return new ChangeFolderTask({
          threads: accountThreads,
          source: 'Dragged out of list',
          folder: dest,
        });
      }
      if (dest instanceof Label) {
        // Label-based archive (e.g. Gmail "All Mail" role='all', or role='archive' on some
        // providers). Archiving via label means removing the thread from the inbox label.
        return new ChangeLabelsTask({
          threads: accountThreads,
          source: 'Dragged out of list',
          labelsToRemove: [CategoryStore.getInboxCategory(accountId)],
        });
      }
      throw new Error(
        `Unexpected type returned from preferredRemovalDestination(): ${dest.constructor.name}`
      );
    });
  }
}

export default SearchMailboxPerspective;
