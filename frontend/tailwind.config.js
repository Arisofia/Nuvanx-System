/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe',
          300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6',
          600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6',
          900: '#4c1d95',
        },
        dark: {
          900: '#050507', 800: '#0c0c10', 700: '#15161b',
          600: '#23252d', 500: '#31343f',
        },
        metal: {
          100: '#f5f5f7',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
        },
      }
    }
  },
  plugins: [],
}

