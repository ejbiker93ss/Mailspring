import { dateSectionFor } from '../lib/date-sections';

describe('thread list date sections', () => {
  const now = new Date(2026, 8, 7, 15, 30);

  it('groups messages into the expected calendar buckets', () => {
    expect(dateSectionFor(new Date(2026, 8, 7, 0, 1), now)).toBe('today');
    expect(dateSectionFor(new Date(2026, 8, 6, 23, 59), now)).toBe('yesterday');
    expect(dateSectionFor(new Date(2026, 8, 2, 12, 0), now)).toBe('last-week');
    expect(dateSectionFor(new Date(2026, 7, 20, 12, 0), now)).toBe('last-month');
    expect(dateSectionFor(new Date(2026, 6, 1, 12, 0), now)).toBe('older');
  });

  it('uses local midnight rather than a rolling 24-hour window', () => {
    expect(dateSectionFor(new Date(2026, 8, 6, 23, 59), new Date(2026, 8, 7, 0, 1))).toBe(
      'yesterday'
    );
  });
});
