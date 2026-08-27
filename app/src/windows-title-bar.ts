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
  if (match) return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;

  const srgbMatch = color.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\)$/i
  );
  if (!srgbMatch) return null;
  return `#${channel(String(Number(srgbMatch[1]) * 255))}${channel(
    String(Number(srgbMatch[2]) * 255)
  )}${channel(String(Number(srgbMatch[3]) * 255))}`;
};
