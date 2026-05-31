// ⚠️ REMOVED
//
// This TooltipProvider was a no-op and never implemented any actual tooltip functionality.
// 
// All current tooltips in the app come from Recharts (<Tooltip />).
//
// This file is kept temporarily for backward compatibility but will be deleted.
// The import in App.tsx has been removed.

import { ReactNode } from 'react'

/** @deprecated This component does nothing. Remove any remaining imports. */
export function TooltipProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>
}
