import { SearchRefinements, isRefinementActive, toggleRefinement } from '../lib/search-refinements';

const refinement = (id: string) => SearchRefinements.find((r) => r.id === id);

describe('search refinements', function () {
  it('adds and removes a refinement', function () {
    const added = toggleRefinement('invoices', refinement('attachment'));
    expect(added).toBe('invoices has:attachment');
    expect(isRefinementActive(added, refinement('attachment'))).toBe(true);
    expect(toggleRefinement(added, refinement('attachment'))).toBe('invoices');
  });

  it('replaces another refinement in the same group', function () {
    const week = toggleRefinement('invoices', refinement('week'));
    expect(week).toBe('invoices since:"7 days ago"');
    expect(toggleRefinement(week, refinement('month'))).toBe('invoices since:"30 days ago"');
  });

  it('leaves unrelated filters of the same type alone', function () {
    const query = 'invoices since:yesterday';
    expect(toggleRefinement(query, refinement('week'))).toBe(
      'invoices since:yesterday since:"7 days ago"'
    );
  });
});
