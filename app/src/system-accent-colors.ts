const DARK_FOREGROUND = '#000000';
const LIGHT_FOREGROUND = '#ffffff';

const relativeLuminance = (hex: string) => {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (first: number, second: number) =>
  (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);

export const readableForegroundForSystemAccent = (color: string): string => {
  if (!/^#[\da-f]{6}$/i.test(color)) return LIGHT_FOREGROUND;

  const background = relativeLuminance(color);
  const darkContrast = contrastRatio(background, relativeLuminance(DARK_FOREGROUND));
  const lightContrast = contrastRatio(background, relativeLuminance(LIGHT_FOREGROUND));
  return darkContrast >= lightContrast ? DARK_FOREGROUND : LIGHT_FOREGROUND;
};
