/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // African Robot Design System
        robot: {
          black:  '#050505',
          brown:  '#5B2C1F',
          amber:  '#FF9F1C',
          gold:   '#F6C453',
          teal:   '#3CCFCF',
          cream:  '#FFF6E9',
          red:    '#FF5A5F',
          blue:   '#60A5FA',
        },
        surface: {
          DEFAULT: '#FAFAF8',
          soft:    '#F5F3EF',
          card:    '#FFFFFF',
          dark:    '#050505',
          border:  '#E8E4DC',
          muted:   '#9E9890',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        'card': '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
        'glow-amber': '0 0 24px rgba(255,159,28,0.4)',
        'glow-teal':  '0 0 24px rgba(60,207,207,0.4)',
        'glow-gold':  '0 0 24px rgba(246,196,83,0.4)',
      },
      animation: {
        'breathe':    'breathe 3s ease-in-out infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'blink':      'blink 0.15s ease-in-out',
        'float':      'float 4s ease-in-out infinite',
      },
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.012)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '0.6' },
          '50%':      { opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-4px)' },
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
}
