const HEX_COLOR = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

const linearize = (channel: number): number => {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (color: string): number => {
  const match = HEX_COLOR.exec(color);
  if (!match) return 1;
  const [, red = "ff", green = "ff", blue = "ff"] = match;
  return (
    0.2126 * linearize(Number.parseInt(red, 16)) +
    0.7152 * linearize(Number.parseInt(green, 16)) +
    0.0722 * linearize(Number.parseInt(blue, 16))
  );
};

export const accessibleForeground = (background: string): string =>
  relativeLuminance(background) > 0.179 ? "#000000" : "#ffffff";
