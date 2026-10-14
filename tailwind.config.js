/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: {
          50: '#E8F0EC',
          100: '#C7D9CF',
          200: '#9FBCAC',
          300: '#6E9A82',
          400: '#3F7A5A',
          500: '#1F5C42',
          600: '#105666',
          700: '#0A3323',
          800: '#062818',
          900: '#031A0F',
        },
        moss: {
          50: '#EFF3E5',
          100: '#DCE5C4',
          200: '#B9CB97',
          300: '#9BB46E',
          400: '#839958',
          500: '#6B7F45',
          600: '#556636',
          700: '#3F4D29',
          800: '#2A331B',
          900: '#161B0E',
        },
        cream: {
          50: '#FDFCF7',
          100: '#FAF8F5',
          200: '#F7F4D5',
          300: '#F0EBBE',
          400: '#E5DD9C',
        },
        rose: {
          50: '#F7E8E5',
          100: '#EFD4CE',
          200: '#E0B0A6',
          300: '#D3968C',
          400: '#B97568',
          500: '#9E5A4D',
        },
      },
      fontFamily: {
        display: ['"Fraunces"', 'serif'],
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        arabic: ['"Amiri"', 'serif'],
      },
      animation: {
        'float-slow': 'float 8s ease-in-out infinite',
        'float-med': 'float 6s ease-in-out infinite',
        'float-fast': 'float 4s ease-in-out infinite',
        'sway': 'sway 7s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
        'grow-stem': 'growStem 3s ease-out forwards',
        'drift': 'drift 20s linear infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'fade-up': 'fadeUp 0.7s ease-out forwards',
        'spin-slow': 'spin 30s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-18px)' },
        },
        sway: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.4', filter: 'blur(8px)' },
          '50%': { opacity: '0.8', filter: 'blur(14px)' },
        },
        growStem: {
          '0%': { strokeDashoffset: '400' },
          '100%': { strokeDashoffset: '0' },
        },
        drift: {
          '0%': { transform: 'translateX(0) translateY(0)' },
          '50%': { transform: 'translateX(30px) translateY(-20px)' },
          '100%': { transform: 'translateX(0) translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backgroundImage: {
        'grain': "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};
