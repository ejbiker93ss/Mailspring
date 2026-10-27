import { MailSortField } from '../../../src/services/mail-sort';

export interface DateOrderedMessageItem {
  searchRank?: number;
  message: {
    id?: string;
    date: Date | string | number;
    unread?: boolean;
    size?: number;
    subject?: string;
    from?: { name?: string; email?: string }[];
  };
}

interface ListOrderOptions {
  unreadOnly: boolean;
  sortAscending: boolean;
  sortField?: MailSortField;
  isSearch?: boolean;
}

export function compareMessageItems(
  a: DateOrderedMessageItem,
  b: DateOrderedMessageItem,
  options: ListOrderOptions
) {
  const { sortField = 'date', sortAscending, isSearch } = options;
  const direction = sortAscending ? 1 : -1;
  const byDate = new Date(b.message.date).getTime() - new Date(a.message.date).getTime();
  let comparison = 0;
  if (sortField === 'relevance' && isSearch) {
    comparison =
      (a.searchRank ?? Number.MAX_SAFE_INTEGER) - (b.searchRank ?? Number.MAX_SAFE_INTEGER);
  } else if (sortField === 'size') {
    const aSize = a.message.size > 0 ? a.message.size : null;
    const bSize = b.message.size > 0 ? b.message.size : null;
    if ((aSize === null) !== (bSize === null)) return aSize === null ? 1 : -1;
    comparison = direction * ((aSize || 0) - (bSize || 0));
  } else if (sortField === 'from' || sortField === 'subject') {
    const value = (item: DateOrderedMessageItem) =>
      sortField === 'subject'
        ? item.message.subject || ''
        : item.message.from?.[0]?.name || item.message.from?.[0]?.email || '';
    comparison = direction * value(a).localeCompare(value(b), undefined, { sensitivity: 'base' });
  } else {
    comparison = -direction * byDate;
  }
  return comparison || byDate || (a.message.id || '').localeCompare(b.message.id || '');
}

export function filterAndSortVisibleItems<T extends DateOrderedMessageItem>(
  items: T[],
  options: ListOrderOptions
): T[] {
  const visible = options.unreadOnly ? items.filter((item) => item.message.unread) : items.slice();
  return visible.sort((a, b) => compareMessageItems(a, b, options));
}
