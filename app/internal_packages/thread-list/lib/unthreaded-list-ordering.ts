export interface DateOrderedMessageItem {
  message: {
    date: Date | string | number;
    unread?: boolean;
  };
}

export function filterAndSortVisibleItems<T extends DateOrderedMessageItem>(
  items: T[],
  { unreadOnly, sortAscending }: { unreadOnly: boolean; sortAscending: boolean }
): T[] {
  const visible = unreadOnly ? items.filter((item) => item.message.unread) : items.slice();
  const direction = sortAscending ? 1 : -1;
  return visible.sort(
    (a, b) => direction * (new Date(a.message.date).getTime() - new Date(b.message.date).getTime())
  );
}
