import React from 'react';
import ReactDOM from 'react-dom';
import ReactTestUtils from 'react-dom/test-utils';
import { ListTabularItem } from '../src/components/list-tabular-item';

describe('ListTabular date section button', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    ReactDOM.unmountComponentAtNode(container);
    container.remove();
  });

  const renderSection = (collapsed: boolean, onToggleSection: (key: string) => void) => {
    ReactDOM.render(
      <ListTabularItem
        item={{ id: 'first-thread' }}
        columns={[]}
        metrics={{ top: 0, height: 41, itemHeight: 0, sectionHeaderHeight: 41 }}
        section={{ key: 'today', label: 'Today', count: 8 }}
        sectionCollapsed={collapsed}
        onToggleSection={onToggleSection}
      />,
      container
    );
    return container.querySelector('.list-tabular-section-toggle') as HTMLButtonElement;
  };

  it('uses the full threaded group header to toggle its date section', () => {
    const onToggleSection = jasmine.createSpy('onToggleSection');
    const button = renderSection(false, onToggleSection);

    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Collapse Today');
    expect(button.textContent.replace(/\s/g, '')).toBe('Today8');

    const styles = window.getComputedStyle(button);
    expect(styles.width).not.toBe('100%');

    ReactTestUtils.Simulate.click(button);
    expect(onToggleSection).toHaveBeenCalledWith('today');

    const collapsedButton = renderSection(true, onToggleSection);
    expect(collapsedButton.getAttribute('aria-expanded')).toBe('false');
    expect(collapsedButton.getAttribute('aria-label')).toBe('Expand Today');
  });
});
