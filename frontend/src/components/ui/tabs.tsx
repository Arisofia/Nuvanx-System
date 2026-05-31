import { createContext, HTMLAttributes, ReactNode, useContext, useMemo, useState } from 'react'

interface TabsContextType {
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextType | undefined>(undefined)

interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  defaultValue: string
}

export function Tabs({ children, defaultValue }: Readonly<TabsProps>) {
  const [value, setValue] = useState(defaultValue)
  const contextValue = useMemo(
    () => ({ value, setValue }),
    [value],
  )

  return <TabsContext.Provider value={contextValue}>{children}</TabsContext.Provider>
}

export function TabsList({ children, className = '' }: Readonly<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div className={`inline-flex h-10 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground ${className}`}>
      {children}
    </div>
  )
}

interface TabsTriggerProps extends Readonly<HTMLAttributes<HTMLButtonElement>> {
  value: string
}

export function TabsTrigger({ value, className = '', children, ...props }: Readonly<TabsTriggerProps>) {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('TabsTrigger must be used inside Tabs')
  }

  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
        context.value === value 
          ? 'bg-background text-foreground shadow-sm' 
          : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
      onClick={() => context.setValue(value)}
      {...props}
    >
      {children}
    </button>
  )
}

interface TabsContentProps extends Readonly<HTMLAttributes<HTMLDivElement>> {
  value: string
  children: ReactNode
}

export function TabsContent({ value, children, className = '', ...props }: Readonly<TabsContentProps>) {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('TabsContent must be used inside Tabs')
  }
  if (context.value !== value) return null
  return (
    <div className={className} {...props}>
      {children}
    </div>
  )
}
