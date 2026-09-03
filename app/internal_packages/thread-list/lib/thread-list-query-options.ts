import { Thread } from 'mailspring-exports';
import ModelQuery from '../../../src/flux/models/query';

export interface ThreadListQueryOptions {
  isSent: boolean;
  sortAscending: boolean;
  unreadOnly: boolean;
}

export function queryWithThreadListOptions(
  source: ModelQuery<Thread> | ModelQuery<Thread[]>,
  { isSent, sortAscending, unreadOnly }: ThreadListQueryOptions
) {
  const dateAttribute = isSent
    ? Thread.attributes.lastMessageSentTimestamp
    : Thread.attributes.lastMessageReceivedTimestamp;
  const query = source
    .clone()
    .replaceOrder(sortAscending ? dateAttribute.ascending() : dateAttribute.descending());

  if (unreadOnly) {
    query.where(Thread.attributes.unread.equal(true));
  }

  return query;
}
