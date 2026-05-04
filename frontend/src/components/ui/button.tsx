import { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'ghost' | 'outline' | 'default'
  size?: 'sm' | 'md' | 'lg'
}

const variantClasses: Record<string, string> = {
  default: 'bg-primary text-background shadow-sm shadow-primary/30 hover:bg-accent',
  ghost: 'bg-transparent text-foreground hover:bg-surface',
  outline: 'border border-border text-foreground hover:bg-surface',
}

const sizeClasses: Record<string, string> = {
  sm: 'px-2 py-1 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
}

export function Button({ children, className = '', variant = 'default', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center rounded-lg font-medium transition ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
