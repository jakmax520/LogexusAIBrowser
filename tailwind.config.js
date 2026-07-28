/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#EEF2FF',
          500: '#6366F1',
          600: '#4F46E5',
        },
        surface: {
          light: '#F9FAFB',
          dark: '#252525',
        },
        hairline: '#E5E7EB',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
