import type { Config } from 'tailwindcss';
const v = (n: string) => `rgb(var(--${n}) / <alpha-value>)`;
export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), raised: v('raised'), sunken: v('sunken'), line: v('line'),
        ink: v('ink'), muted: v('muted'), faint: v('faint'),
        accent: { DEFAULT: v('accent'), ink: v('accent-ink'), soft: v('accent-soft') },
        good: { DEFAULT: v('good'), soft: v('good-soft') }, warn: { DEFAULT: v('warn'), soft: v('warn-soft') }, bad: { DEFAULT: v('bad'), soft: v('bad-soft') },
        rail: { DEFAULT: v('rail'), ink: v('rail-ink') },
      },
      fontFamily: {
        display: ['"Manrope Variable"', '"Manrope"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        sans: ['"Inter Variable"', '"Inter"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '18px' },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / .06), 0 8px 24px -12px rgb(var(--shadow) / .18)',
        pop: '0 24px 64px -16px rgb(var(--shadow) / .45), 0 2px 6px rgb(var(--shadow) / .08)',
        glow: '0 8px 24px -10px rgb(var(--accent) / .65)',
      },
      keyframes: {
        rise: { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'none' } },
        slide: { from: { opacity: '.3', transform: 'translateX(28px)' }, to: { opacity: '1', transform: 'none' } },
        pop: { from: { opacity: '0', transform: 'scale(.97)' }, to: { opacity: '1', transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { rise: 'rise .25s ease-out both', slide: 'slide .24s cubic-bezier(.2,.8,.2,1) both', pop: 'pop .16s ease-out both', shimmer: 'shimmer 1.4s infinite' },
    },
  },
  plugins: [],
} satisfies Config;
