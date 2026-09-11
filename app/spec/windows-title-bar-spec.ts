import { electronHexColor, windowsTitleBarOverlayColors } from '../src/windows-title-bar';

const style = (
  properties: Record<string, string>,
  backgroundColor = 'rgba(0, 0, 0, 0)',
  color = 'rgb(238, 241, 255)'
) =>
  ({
    backgroundColor,
    color,
    getPropertyValue: (name: string) => properties[name] || '',
  }) as Pick<CSSStyleDeclaration, 'backgroundColor' | 'color' | 'getPropertyValue'>;

describe('Windows title bar theme colors', () => {
  it('uses explicit theme tokens when the title bar background is a gradient', () => {
    expect(
      windowsTitleBarOverlayColors(
        style({
          '--sm-titlebar-color': '#0a0e1c',
          '--sm-titlebar-symbol-color': '#eef1ff',
        })
      )
    ).toEqual({ color: '#0a0e1c', symbolColor: '#eef1ff' });
  });

  it('falls back to computed solid colors for existing themes', () => {
    expect(
      windowsTitleBarOverlayColors(style({}, 'rgb(240, 245, 252)', 'rgb(23, 26, 47)'))
    ).toEqual({ color: '#f0f5fc', symbolColor: '#171a2f' });
  });

  it('does not mistake a transparent gradient layer for black', () => {
    expect(electronHexColor('rgba(0, 0, 0, 0)')).toBe(null);
  });
});
