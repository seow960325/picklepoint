/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0e17',
        panel: '#121826',
        edge: '#1f2937',
        lime: '#c6ff3d',
        cyan: '#22d3ee',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'Impact', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
