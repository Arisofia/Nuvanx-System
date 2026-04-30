import { createContext, HTMLAttributes, ReactNode, useContext, useState } from 'react'

interface TabsContextType {
  value: string
  setValue: (value: string) => void
}

const TabsContext = createContext<TabsContextType | undefined>(undefined)

interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  defaultValue: string
}

export function Tabs({ children, defaultValue }: TabsProps) {
  const [value, setValue] = useState(defaultValue)
  return (
    <TabsContext.Provider value={{ value, setValue }}>{children}</TabsContext.Provider>
  )
}

export function TabsList({ children, className = '' }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex flex-wrap gap-2 ${className}`}>{children}</div>
}

interface TabsTriggerProps extends HTMLAttributes<HTMLButtonElement> {
  value: string
}

export function TabsTrigger({ value, className = '', children, ...props }: TabsTriggerProps) {
  const context = useContext(TabsContext)
  if (!context) {
    throw new Error('TabsTrigger must be used inside Tabs')
  }

  return (
    <button
      type="button"
      className={`rounded-lg border border-border px-3 py-2 text-sm transition ${context.value === value ? 'bg-primary text-white' : 'bg-slate-950 text-slate-200'} ${className}`}
      onClick={() => context.setValue(value)}
      {...props}
    >
      {children}
    </button>
  )
}

interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  children: ReactNode
}

export function TabsContent({ value, children, className = '', ...props }: TabsContentProps) {
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
