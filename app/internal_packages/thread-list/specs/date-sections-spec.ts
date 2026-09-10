import { shouldShowDateSections, toggleDateSection } from '../lib/date-sections';

describe('date section controls', () => {
  it('hides chronological section headers for relevance-ranked search results', () => {
    expect(shouldShowDateSections({ searchQuery: 'feed order' })).toBe(false);
    expect(shouldShowDateSections({})).toBe(true);
  });

  it('uses the same immutable toggle behavior in every conversation view', () => {
    const initial = { today: true };
    const expanded = toggleDateSection(initial, 'today');

    expect(initial.today).toBe(true);
    expect(expanded.today).toBe(false);
    expect(toggleDateSection(expanded, 'today').today).toBe(true);
    expect(toggleDateSection(expanded, 'yesterday')).toEqual({
      today: false,
      yesterday: true,
    });
  });
});
