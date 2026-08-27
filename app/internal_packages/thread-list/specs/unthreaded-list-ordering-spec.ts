import { filterAndSortVisibleItems } from '../lib/unthreaded-list-ordering';

describe('unthreaded list ordering', () => {
  const items = [
    { id: 'middle', message: { date: '2026-08-27T12:00:00Z', unread: true } },
    { id: 'newest', message: { date: '2026-08-27T13:00:00Z', unread: false } },
    { id: 'oldest', message: { date: '2026-08-27T11:00:00Z', unread: true } },
  ];

  it('sorts messages in either direction without mutating the source list', () => {
    expect(
      filterAndSortVisibleItems(items, { unreadOnly: false, sortAscending: false }).map(
        (item) => item.id
      )
    ).toEqual(['newest', 'middle', 'oldest']);
    expect(
      filterAndSortVisibleItems(items, { unreadOnly: false, sortAscending: true }).map(
        (item) => item.id
      )
    ).toEqual(['oldest', 'middle', 'newest']);
    expect(items.map((item) => item.id)).toEqual(['middle', 'newest', 'oldest']);
  });

  it('removes read messages when unread-only mode is active', () => {
    expect(
      filterAndSortVisibleItems(items, { unreadOnly: true, sortAscending: false }).map(
        (item) => item.id
      )
    ).toEqual(['middle', 'oldest']);
  });
});
