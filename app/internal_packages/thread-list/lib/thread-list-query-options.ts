import { Thread } from 'summermail-exports';
import ModelQuery from '../../../src/flux/models/query';
import { SortOrder } from '../../../src/flux/attributes/sort-order';
import { MailSortField, threadSortSQL } from '../../../src/services/mail-sort';

class MailListSortOrder extends SortOrder {
  constructor(
    private field: MailSortField,
    private ascending: boolean,
    private isSent: boolean
  ) {
    // Subject is not replicated onto ThreadCategory; correlated message queries
    // must execute against Thread rather than the category-only optimization.
    super(Thread.attributes.subject);
  }

  orderBySQL() {
    return threadSortSQL(this.field, this.ascending, this.isSent);
  }
}

export interface ThreadListQueryOptions {
  isSent: boolean;
  sortAscending: boolean;
  sortField?: MailSortField;
  unreadOnly: boolean;
}

export function queryWithThreadListOptions<T extends Thread | Thread[]>(
  source: ModelQuery<T>,
  { isSent, sortAscending, unreadOnly, sortField = 'date' }: ThreadListQueryOptions
) {
  const dateAttribute = isSent
    ? Thread.attributes.lastMessageSentTimestamp
    : Thread.attributes.lastMessageReceivedTimestamp;
  const order = ['date', 'relevance'].includes(sortField)
    ? sortAscending
      ? dateAttribute.ascending()
      : dateAttribute.descending()
    : new MailListSortOrder(sortField, sortAscending, isSent);
  const query = source.clone().replaceOrder(order);

  if (unreadOnly) {
    query.where(Thread.attributes.unread.equal(true));
  }

  return query;
}
