/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        shell: {
          950: '#03040a',
          900: '#05070f',
          850: '#071025',
          800: '#0b1324',
          750: '#101b33',
        },
        accent: {
          emerald: '#5ff2c7',
          blue: '#6ea8ff',
          ocean: '#4cc6ff',
        },
      },
      backgroundImage: {
        'shell-slate':
          'radial-gradient(circle at 18% 6%, rgba(110, 168, 255, 0.35) 0%, rgba(13, 21, 44, 0) 50%), radial-gradient(circle at 82% 4%, rgba(95, 242, 199, 0.28) 0%, rgba(11, 19, 38, 0) 54%), radial-gradient(circle at 50% 58%, rgba(8, 14, 30, 0.96) 0%, rgba(6, 11, 24, 0.98) 60%, rgba(5, 9, 19, 0.99) 100%)',
      },
      boxShadow: {
        'shell-card': '0 30px 80px rgba(3, 7, 18, 0.55)',
        'accent-glow': '0 0 0 1px rgba(95, 242, 199, 0.35), 0 0 36px rgba(110, 168, 255, 0.25)',
      },
      backdropBlur: {
        shell: '28px',
      },
      transitionTimingFunction: {
        'out-back': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      scale: {
        102: '1.02',
        103: '1.03',
      },
      ringOffsetColor: {
        shell: '#05070f',
      },
    },
  },
  plugins: [],
};
