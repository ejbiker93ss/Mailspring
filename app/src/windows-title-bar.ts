export const WINDOWS_TITLE_BAR_HEIGHT = 40;

export const WINDOWS_COMPOSER_TITLE_BAR_OVERLAY = {
  color: '#111111',
  symbolColor: '#ffffff',
  height: WINDOWS_TITLE_BAR_HEIGHT,
};

// Electron's title-bar overlay accepts hex colors, while getComputedStyle()
// normally returns theme colors as rgb()/rgba(). Normalize the computed color
// before handing it to Electron so every installed theme can drive the native
// caption button colors.
export const electronHexColor = (color: string): string | null => {
  const hexMatch = color.match(/^#([\da-f]{6})(?:[\da-f]{2})?$/i);
  if (hexMatch) return `#${hexMatch[1]}`;
  const match = color.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d+(?:\.\d+)?%?))?\s*\)$/i
  );

  const channel = (value: string) =>
    Math.max(0, Math.min(255, Math.round(Number(value))))
      .toString(16)
      .padStart(2, '0');
  if (match) {
    const alpha = match[4];
    if (alpha && (alpha.endsWith('%') ? Number(alpha.slice(0, -1)) : Number(alpha) * 100) < 1) {
      return null;
    }
    return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
  }

  const srgbMatch = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\)$/i
  );
  if (!srgbMatch) return null;
  return `#${channel(String(Number(srgbMatch[1]) * 255))}${channel(
    String(Number(srgbMatch[2]) * 255)
  )}${channel(String(Number(srgbMatch[3]) * 255))}`;
};

export const windowsTitleBarOverlayColors = (
  style: Pick<CSSStyleDeclaration, 'backgroundColor' | 'color' | 'getPropertyValue'>
): { color: string; symbolColor: string } | null => {
  const themedColor = style.getPropertyValue('--sm-titlebar-color').trim();
  const themedSymbolColor = style.getPropertyValue('--sm-titlebar-symbol-color').trim();
  const color = electronHexColor(themedColor) || electronHexColor(style.backgroundColor);
  const symbolColor = electronHexColor(themedSymbolColor) || electronHexColor(style.color);
  return color && symbolColor ? { color, symbolColor } : null;
};
