/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: '#080705',
        surface: '#120f0c',
        card: '#17120f',
        border: '#4f3d27',
        foreground: '#f7efe6',
        muted: '#a38f79',
        primary: '#c9a471',
        secondary: '#b08b5a',
        accent: '#d4b37d',
        'accent-hover': '#b99956',
        brand: {
          50: '#fdf7f0',
          100: '#f8efe0',
          200: '#eed8c1',
          300: '#e4c2a0',
          400: '#d0a270',
          500: '#c09a5f',
          600: '#a27c4c',
          700: '#84643b',
          800: '#664f2f',
          900: '#4a3925',
        },
        dark: {
          900: '#050507',
          800: '#0b0b0f',
          700: '#16161d',
          600: '#272b34',
          500: '#383f4d',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

