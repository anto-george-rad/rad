/** Turns one brand colour into the accent tokens for light and dark themes. Pure, so it is unit-tested. */
const hexRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; };
const mix = (a: number[], b: number[], t: number): number[] => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const t = (c: number[]) => c.join(' ');
const WHITE = [255, 255, 255], INK = [9, 12, 22], DARK_BG = [17, 21, 36];

export function brandTokens(hex: string) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  let light: number[] = hexRgb(hex);
  // Keep text-on-surface legible: darken until the accent reaches 4.5:1 on white.
  for (let i = 0; i < 12 && contrast(light, WHITE) < 4.5; i++) light = mix(light, INK, 0.12);
  const lightInk = contrast(WHITE, light) >= contrast(INK, light) ? WHITE : INK;
  let dark = mix(hexRgb(hex), WHITE, 0.32);
  for (let i = 0; i < 12 && contrast(dark, DARK_BG) < 4.5; i++) dark = mix(dark, WHITE, 0.15);
  const darkInk = contrast(INK, dark) >= contrast(WHITE, dark) ? INK : WHITE;
  return {
    light: { accent: t(light), ink: t(lightInk), soft: t(mix(light, WHITE, 0.9)) },
    dark: { accent: t(dark), ink: t(darkInk), soft: t(mix(DARK_BG, dark, 0.22)) },
  };
}
export function brandCss(hex: string) {
  const b = brandTokens(hex); if (!b || hex.toUpperCase() === '#4C5BFF') return '';
  const L = `--accent:${b.light.accent};--accent-ink:${b.light.ink};--accent-soft:${b.light.soft};`;
  const D = `--accent:${b.dark.accent};--accent-ink:${b.dark.ink};--accent-soft:${b.dark.soft};`;
  return `:root{${L}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${D}}}:root[data-theme="dark"]{${D}}`;
}
