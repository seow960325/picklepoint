/** @type {import('tailwindcss').Config} */
function withOpacity(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `rgb(var(${varName}))`
      : `rgb(var(${varName}) / ${opacityValue})`
}

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: withOpacity('--canvas'),
        surface: withOpacity('--surface'),
        'surface-2': withOpacity('--surface-2'),
        line: withOpacity('--line'),
        'line-strong': withOpacity('--line-strong'),
        fg: withOpacity('--fg'),
        'fg-muted': withOpacity('--fg-muted'),
        'fg-subtle': withOpacity('--fg-subtle'),
        brand: withOpacity('--brand'),
        'brand-hover': withOpacity('--brand-hover'),
        'brand-fg': withOpacity('--brand-fg'),
        'brand-ink': withOpacity('--brand-ink'),
        accent: withOpacity('--accent'),
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Impact', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
