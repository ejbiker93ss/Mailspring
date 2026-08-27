import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { OutlineView } from '../../src/components/outline-view';

describe('OutlineView section collapse control', () => {
  afterEach(cleanup);

  it('collapses the entire section from its heading', () => {
    const onCollapseToggled = jasmine.createSpy('onCollapseToggled');
    const { getByRole } = render(
      <OutlineView
        title="support@example.com"
        items={[]}
        collapsed={false}
        onCollapseToggled={onCollapseToggled}
      />
    );
    const button = getByRole('button', { name: 'Collapse support@example.com' });

    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(button);

    expect(onCollapseToggled).toHaveBeenCalled();
  });

  it('exposes an expand action for a collapsed section', () => {
    const { getByRole } = render(
      <OutlineView title="support@example.com" items={[]} collapsed onCollapseToggled={() => {}} />
    );
    const button = getByRole('button', { name: 'Expand support@example.com' });

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('.section-collapse-chevron').classList.contains('collapsed')).toBe(
      true
    );
  });
});
