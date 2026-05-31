import { HTMLAttributes, ReactNode } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: Readonly<CardProps>) {
  return (
    <div className={`card-panel ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardHeader({ children, className = '', ...props }: Readonly<CardProps>) {
  return (
    <div className={`card-header-panel ${className}`} {...props}>
      {children}
    </div>
  )
}

export function CardTitle({ children, className = '', ...props }: Readonly<CardProps>) {
  return (
    <h2 className={`card-title-panel ${className}`} {...props}>
      {children}
    </h2>
  )
}

export function CardDescription({ children, className = '', ...props }: Readonly<CardProps>) {
  return (
    <p className={`card-description-panel ${className}`} {...props}>
      {children}
    </p>
  )
}

export function CardContent({ children, className = '', ...props }: Readonly<CardProps>) {
  return (
    <div className={`card-content-panel ${className}`} {...props}>
      {children}
    </div>
  )
}
