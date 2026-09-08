import {
  ListTabular,
  listIndexForOffset,
  listOffsetForIndex,
} from '../src/components/list-tabular';

describe('ListTabular section layout', () => {
  const boundaries = [0, 3, 7];

  it('allocates header space only before section-leading rows', () => {
    expect(listOffsetForIndex(0, 36, 41, boundaries)).toBe(0);
    expect(listOffsetForIndex(1, 36, 41, boundaries)).toBe(77);
    expect(listOffsetForIndex(3, 36, 41, boundaries)).toBe(149);
    expect(listOffsetForIndex(4, 36, 41, boundaries)).toBe(226);
  });

  it('maps scroll offsets back to the correct virtual row', () => {
    expect(listIndexForOffset(0, 10, 36, 41, boundaries)).toBe(0);
    expect(listIndexForOffset(76, 10, 36, 41, boundaries)).toBe(0);
    expect(listIndexForOffset(77, 10, 36, 41, boundaries)).toBe(1);
    expect(listIndexForOffset(148, 10, 36, 41, boundaries)).toBe(2);
    expect(listIndexForOffset(149, 10, 36, 41, boundaries)).toBe(3);
  });

  it('removes collapsed rows while retaining their compact date header', () => {
    const sectionKeys = { 0: 'today', 3: 'yesterday', 7: 'last-week' };
    const collapsed = { yesterday: true };

    expect(listOffsetForIndex(3, 36, 41, boundaries, collapsed, sectionKeys)).toBe(149);
    expect(listOffsetForIndex(4, 36, 41, boundaries, collapsed, sectionKeys)).toBe(190);
    expect(listOffsetForIndex(7, 36, 41, boundaries, collapsed, sectionKeys)).toBe(190);
    expect(listIndexForOffset(190, 10, 36, 41, boundaries, collapsed, sectionKeys)).toBe(7);
  });

  it('includes the following group when a large first group is collapsed', () => {
    const list = new ListTabular({
      columns: [],
      itemHeight: 80,
      sectionHeaderHeight: 41,
      collapsedSections: { today: true },
      dataSource: {
        get: () => null,
        count: () => 110,
        loaded: () => true,
        empty: () => false,
      } as any,
    });
    list._sectionBoundaries = {
      0: { key: 'today', label: 'Today' },
      100: { key: 'yesterday', label: 'Yesterday' },
    };
    list._scrollRegion = { scrollTop: 0 } as any;
    expect(list.getRange().end).toBeGreaterThan(100);
  });

  it('retains known section boundaries when earlier rows leave the loaded range', () => {
    const list = new ListTabular({
      columns: [],
      itemHeight: 80,
      sectionForItem: () => ({ key: 'today', label: 'Today' }),
      dataSource: {
        get: (index) => (index === 20 ? { id: 'twenty' } : null),
        count: () => 30,
        loaded: () => true,
        empty: () => false,
      } as any,
    });
    list._sectionBoundaries = { 0: { key: 'today', label: 'Today' } };
    list._updateSectionBoundaries();
    expect(list._sectionBoundaries[0].key).toBe('today');
    expect(list._sectionBoundaries[20]).toBeUndefined();
  });
});
