import { ReactNode } from 'react'

export function TooltipProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>
}
