import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`
          w-full rounded-lg border bg-surface px-3 py-2 text-sm text-foreground
          placeholder:text-muted outline-none transition-colors
          focus:border-primary focus:ring-2 focus:ring-primary/20
          disabled:cursor-not-allowed disabled:opacity-50
          ${error ? 'border-destructive focus:border-destructive focus:ring-destructive/20' : 'border-border'}
          ${className}
        `}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'
