import { listIndexForOffset, listOffsetForIndex } from '../src/components/list-tabular';

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
});
