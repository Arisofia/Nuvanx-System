/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: '#FAF7F2',
        surface: '#FFFFFF',
        card: '#FFFFFF',
        border: '#E5D5C5',
        foreground: '#2C2825',
        muted: '#8E8680',
        primary: '#B08B5A',
        'primary-foreground': '#FFFFFF',
        secondary: '#C9B08E',
        accent: '#D4B37D',
        'accent-hover': '#B08B5A',
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
          900: '#050503',
          800: '#0d0b09',
          700: '#1a1410',
          600: '#2d2218',
          500: '#3f3224',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Manrope', 'system-ui', 'sans-serif'],
        serif: ['Playfair Display', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}

