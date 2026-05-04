import { createContext, ReactNode, useContext, useMemo, useState } from 'react'

export interface ThemeContextType {
  theme: 'light' | 'dark'
  setTheme: (theme: 'light' | 'dark') => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ defaultTheme, children }: Readonly<{ defaultTheme: 'light' | 'dark'; children: ReactNode }>) {
  const [theme, setTheme] = useState<'light' | 'dark'>(defaultTheme)

  const value = useMemo(() => ({ theme, setTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
