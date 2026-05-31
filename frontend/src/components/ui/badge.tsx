import { HTMLAttributes, ReactNode } from 'react'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode
}

export function Badge({ children, className = '', ...props }: Readonly<BadgeProps>) {
  return (
    <span className={`badge ${className}`} {...props}>
      {children}
    </span>
  )
}
