import { InputHTMLAttributes } from 'react'

export function Input(props: Readonly<InputHTMLAttributes<HTMLInputElement>>) {
  return (
    <input
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      {...props}
    />
  )
}
