import { TextareaHTMLAttributes } from 'react'

export function Textarea(props: Readonly<TextareaHTMLAttributes<HTMLTextAreaElement>>) {
  return (
    <textarea
      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      {...props}
    />
  )
}
