import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { QuotedTextControl } from '../lib/quoted-text-control';

describe('QuotedTextControl', () => {
  afterEach(cleanup);

  const renderControl = (quotedTextHidden: boolean) => {
    const onUnhide = jasmine.createSpy('onUnhide');
    const onHide = jasmine.createSpy('onHide');
    const onRemove = jasmine.createSpy('onRemove');
    const result = render(
      <QuotedTextControl
        quotedTextPresent
        quotedTextHidden={quotedTextHidden}
        onUnhide={onUnhide}
        onHide={onHide}
        onRemove={onRemove}
      />
    );
    return { ...result, onUnhide, onHide };
  };

  it('remains visible and collapses expanded quoted text', () => {
    const { container, onHide } = renderControl(false);
    const control = container.querySelector('.quoted-text-control');

    expect(control).not.toBeNull();
    expect(control.classList.contains('expanded')).toBe(true);
    fireEvent.mouseDown(control);
    expect(onHide).toHaveBeenCalled();
  });

  it('expands hidden quoted text', () => {
    const { container, onUnhide } = renderControl(true);
    fireEvent.mouseDown(container.querySelector('.quoted-text-control'));
    expect(onUnhide).toHaveBeenCalled();
  });
});
